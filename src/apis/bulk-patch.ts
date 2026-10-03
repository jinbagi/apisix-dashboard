/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { req } from '@/config/req';
import { verifyAdminApiResource } from '@/utils/adminApiVerification';
import { buildPatchPayload, getPatchConflictPaths, isRecord, PATCH_READONLY_KEYS } from '@/utils/apisixEditable';
import { getAdminResourceSchema } from '@/utils/resourceJsonSchema';

export const supportsBulkPatch = (api: string) =>
  ['/routes', '/stream_routes', '/services', '/upstreams', '/plugin_configs'].includes(api);

export type BulkPatchRow = {
  id: string;
  api: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  status: 'Ready' | 'Unchanged' | 'Blocked' | 'Saved' | 'Failed' | 'Unverified';
  error?: string;
};
export const isBulkPatchFailure = (row: BulkPatchRow) =>
  ['Blocked', 'Failed', 'Unverified'].includes(row.status);

function rejectUnsafeKeys(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      throw new Error(`Unsupported property: ${key}`);
    rejectUnsafeKeys(child);
  }
}
export function parseBulkPatch(text: string): Record<string, unknown> {
  const patch: unknown = JSON.parse(text);
  if (!isRecord(patch) || Object.keys(patch).length === 0)
    throw new Error('Enter a non-empty JSON object containing the fields to change.');
  rejectUnsafeKeys(patch);
  const readonly = PATCH_READONLY_KEYS.filter((key) => Object.hasOwn(patch, key));
  if (readonly.length) throw new Error(`Read-only fields cannot be patched: ${readonly.join(', ')}`);
  return patch;
}

/** APISIX object PATCH: merge objects, replace arrays, remove properties with null. */
export function applyBulkPatch(before: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const after = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete after[key];
    else after[key] = isRecord(value)
      ? applyBulkPatch(isRecord(before[key]) ? before[key] : {}, value)
      : value;
  }
  return after;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Admin API request failed';
async function readResource(api: string, id: string): Promise<Record<string, unknown>> {
  const { data } = await req.get(api, { timeout: 15_000, headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] } });
  if (!isRecord(data?.value) || String(data.value.id) !== id)
    throw new Error('The selected resource could not be read with its expected identity.');
  rejectUnsafeKeys(data.value);
  return { ...data.value, id };
}
function validate(api: string, value: Record<string, unknown>) {
  const result = getAdminResourceSchema(api)?.safeParse(value);
  if (!result) throw new Error('This resource does not support bulk RAW editing.');
  if (!result.success) throw new Error(result.error.issues.map((issue) =>
    `${issue.path.join('.') || 'Resource'}: ${issue.message}`).join('; '));
  // Keep the original JSON: parsing must not remove fields absent from the local schema.
}
export async function prepareBulkPatch(apiBase: string, ids: string[], patch: Record<string, unknown>): Promise<BulkPatchRow[]> {
  if (!supportsBulkPatch(apiBase)) throw new Error('This resource does not support bulk RAW editing.');
  parseBulkPatch(JSON.stringify(patch));
  const rows: BulkPatchRow[] = [];
  const selected = [...new Set(ids)];
  for (let offset = 0; offset < selected.length; offset += 4) {
    rows.push(...await Promise.all(selected.slice(offset, offset + 4).map(async (id): Promise<BulkPatchRow> => {
      const api = `${apiBase}/${encodeURIComponent(id)}`;
      try {
        if (!id || id === '.' || id === '..') throw new Error('Invalid resource identity.');
        const before = await readResource(api, id);
        const after = applyBulkPatch(before, patch);
        validate(api, after);
        const delta = buildPatchPayload(after, before);
        return { id, api, before, after, patch: delta, status: Object.keys(delta).length ? 'Ready' : 'Unchanged' };
      } catch (error) { return { id, api, status: 'Blocked', error: message(error) }; }
    })));
  }
  return rows;
}
export async function applyBulkPatchRow(row: BulkPatchRow): Promise<BulkPatchRow> {
  if (row.status !== 'Ready' || !row.patch || !row.before) return row;
  let writeAttempted = false;
  try {
    const current = await readResource(row.api, row.id);
    const conflicts = getPatchConflictPaths(row.patch, row.before, current);
    if (conflicts.length) throw new Error(`Changed since preview: ${conflicts.join(', ')}. Preview this item again.`);
    const after = applyBulkPatch(current, row.patch);
    validate(row.api, after);
    const delta = buildPatchPayload(after, current);
    if (!Object.keys(delta).length) return { ...row, status: 'Unchanged', error: undefined };
    writeAttempted = true;
    await req.patch(row.api, delta, { timeout: 15_000 });
    await verifyAdminApiResource(row.api, delta, { timeoutMs: 15_000 });
    return { ...row, status: 'Saved', error: undefined };
  } catch (error) {
    // A network error after sending PATCH cannot establish whether the server committed it.
    return { ...row, status: writeAttempted ? 'Unverified' : 'Failed',
      error: `${writeAttempted ? 'Write outcome is unverified. ' : ''}${message(error)}` };
  }
}
