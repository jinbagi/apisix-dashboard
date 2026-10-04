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

export type ImportPreviewItem = {
  key: string; resourceType: ResourceKey; index: number; id: string;
  status: 'New' | 'Changed' | 'Unchanged' | 'Blocked';
  sourceUrl?: string; sourceBody?: Record<string, unknown>;
  url?: string; before?: Record<string, unknown> | null; after?: Record<string, unknown>; error?: string;
};
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Unable to read current APISIX configuration';

async function currentBody(resourceType: ResourceKey, item: Record<string, unknown>, url: string) {
  try {
    const response = await req.get(url, { headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] } });
    if (!isRecord(response.data?.value)) throw new Error('Admin API returned no resource value');
    // Export-only owner metadata is absent from child endpoint responses.
    const identity: Record<string, unknown> = { id: item.id };
    if (resourceType === 'credentials' || resourceType === 'consumers') identity.username = item.username;
    if (resourceType === 'graphqlCostDecorations') identity.service_id = item.service_id;
    if (resourceType === 'secrets') identity.manager = item.manager;
    return getImportRequest(resourceType, { ...identity, ...response.data.value }).body;
  } catch (cause) {
    if ((cause as { response?: { status?: number } }).response?.status === 404) return null;
    throw cause;
  }
}

export async function previewImport(data: ExportData, selected: ResourceKey[]): Promise<ImportPreviewItem[]> {
  const plan: ImportPreviewItem[] = [];
  const inputs = new Map<string, Record<string, unknown>>();
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
        inputs.set(row.key, item);
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
        row.before = await currentBody(row.resourceType, inputs.get(row.key)!, row.url!);
        row.status = row.before === null ? 'New' : isDeepEqual(row.before, row.after) ? 'Unchanged' : 'Changed';
      } catch (cause) { row.error = errorText(cause); }
    }));
  }
  return plan;
}

/** A fresh read prevents overwriting changes observed after the preview. This is not atomic CAS. */
export async function verifyImportPreview(row: ImportPreviewItem | undefined, item: Record<string, unknown>) {
  if (!row || row.status === 'Blocked' || !row.url) throw new Error(row?.error ?? 'No valid preview for this resource');
  if (row.status === 'Unchanged') return false;
  const current = await currentBody(row.resourceType, item, row.url);
  if (!isDeepEqual(current, row.before)) throw new Error('Resource changed after preview. Preview again before importing.');
  return true;
}
