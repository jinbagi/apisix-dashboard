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
import { type ExportData, getImportRequest, IMPORT_ORDER, type ResourceKey } from '@/apis/export-import';
import { SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { req } from '@/config/req';
import { isDeepEqual, isRecord } from '@/utils/apisixEditable';
import { validateExactResourceSnapshot } from '@/utils/resourceIdentity';
import { assertRestorableExport } from '@/utils/sharingFormat';

export type ImportPreviewItem = {
  key: string; resourceType: ResourceKey; index: number; id: string;
  status: 'New' | 'Changed' | 'Unchanged' | 'Blocked';
  sourceUrl?: string; sourceBody?: Record<string, unknown>;
  url?: string; before?: Record<string, unknown> | null; after?: Record<string, unknown>; error?: string;
};
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Unable to read current APISIX configuration';

export function importResourceBody(resourceType: ResourceKey, url: string, value: Record<string, unknown>) {
  // Normalize verified response identities for the existing import payload contract.
  // The raw response is preserved; only export-only owner metadata is supplied.
  const segments = url.split('/').slice(1).map(decodeURIComponent);
  const copy = { ...value };
  if (resourceType === 'credentials') { copy.id = segments.at(-1); copy.username = segments[1]; }
  if (resourceType === 'secrets') { copy.id = segments.at(-1); copy.manager = segments[1]; }
  if (resourceType === 'graphqlCostDecorations') copy.service_id = segments[1];
  if (resourceType === 'pluginMetadata') copy.id = segments.at(-1);
  const current = getImportRequest(resourceType, copy);
  if (current.url !== url) throw new Error(`Admin API resource identity could not be verified for ${url}`);
  return current.body;
}

export async function readImportResource(resourceType: ResourceKey, url: string) {
  try {
    const response = await req.get(url, { timeout: 15_000, headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] } });
    const value: unknown = response.data?.value;
    validateExactResourceSnapshot(url, value, response.data?.key);
    return importResourceBody(resourceType, url, value);
  } catch (cause) {
    if ((cause as { response?: { status?: number } }).response?.status === 404) return null;
    throw cause;
  }
}

export async function previewImport(data: ExportData, selected: ResourceKey[]): Promise<ImportPreviewItem[]> {
  assertRestorableExport(data);
  const plan: ImportPreviewItem[] = [];
  for (const resourceType of IMPORT_ORDER.filter((key) => selected.includes(key))) {
    const items: unknown = data.resources[resourceType] ?? [];
    if (!Array.isArray(items)) throw new Error(`${resourceType} must be an array`);
    items.forEach((item: unknown, index) => {
      const row: ImportPreviewItem = {
        key: `${resourceType}:${index}`, resourceType, index,
        id: isRecord(item) ? String(item.id ?? item.username ?? `Item ${index + 1}`) : `Item ${index + 1}`,
        status: 'Blocked',
      };
      try {
        if (!isRecord(item)) throw new Error('Resource must be a JSON object');
        const request = getImportRequest(resourceType, item);
        Object.assign(row, { url: request.url, after: request.body });
      } catch (cause) { row.error = errorText(cause); }
      plan.push(row);
    });
  }
  const counts = new Map<string, number>();
  for (const row of plan) if (row.url) counts.set(row.url, (counts.get(row.url) ?? 0) + 1);
  for (const row of plan) if (row.url && counts.get(row.url)! > 1) row.error = 'Duplicate destination in this import file';
  const readable = plan.filter((row) => !row.error && row.url);
  for (let start = 0; start < readable.length; start += 4) {
    await Promise.all(readable.slice(start, start + 4).map(async (row) => {
      try {
        row.before = await readImportResource(row.resourceType, row.url!);
        row.status = row.before === null ? 'New' : isDeepEqual(row.before, row.after) ? 'Unchanged' : 'Changed';
      } catch (cause) { row.error = errorText(cause); }
    }));
  }
  return plan;
}

/** Compare a fresh read or an already identity-verified final snapshot. This is not atomic CAS. */
export async function verifyImportPreview(
  row: ImportPreviewItem | undefined, item: Record<string, unknown>, latest?: Record<string, unknown> | null,
) {
  if (!row || row.status === 'Blocked' || !row.url) throw new Error(row?.error ?? 'No valid preview for this resource');
  if (getImportRequest(row.resourceType, item).url !== row.url) throw new Error('Import destination changed after preview. Preview again before importing.');
  if (row.status === 'Unchanged') return false;
  const current = latest === undefined ? await readImportResource(row.resourceType, row.url)
    : latest === null ? null : importResourceBody(row.resourceType, row.url, latest);
  if (!isDeepEqual(current, row.before)) throw new Error('Resource changed after preview. Preview again before importing.');
  return true;
}
