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
import { EXPORT_VERSION, type ExportData, getImportRequest, IMPORT_ORDER, type ResourceKey } from '@/apis/export-import';
import { SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { req } from '@/config/req';
import { isRecord } from '@/utils/apisixEditable';
import { type CollectionCoverage, type ExportCoverage, normalizedScopeValues } from '@/utils/exportCoverage';
import { validateExactResourceSnapshot } from '@/utils/resourceIdentity';

/** A malformed or partially read collection must never become an exported empty/partial collection. */
export class InvalidExportCollection extends Error {}
const fail = (api: string) => new InvalidExportCollection(`Could not verify the complete collection ${api}. No file was exported. Refresh and retry.`);
const requestConfig = { timeout: 15_000, headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] } };
const paths: Partial<Record<ResourceKey, string>> = {
  upstreams: '/upstreams', services: '/services', routes: '/routes', streamRoutes: '/stream_routes', consumers: '/consumers',
  consumerGroups: '/consumer_groups', ssls: '/ssls', globalRules: '/global_rules', pluginConfigs: '/plugin_configs', protos: '/protos', secrets: '/secrets',
};

export async function readExportCollection(kind: ResourceKey, api: string, owner?: string) {
  const items: Record<string, unknown>[] = []; const seen = new Set<string>(); let total: number | undefined;
  for (let page = 1; ; page++) {
    let data;
    try { ({ data } = await req.get(api, { ...requestConfig, params: { page, page_size: 100 } })); }
    catch (cause) {
      if (owner && page === 1 && (cause as { response?: { status?: number } }).response?.status === 404) {
        try { const response = await req.get(owner, requestConfig); validateExactResourceSnapshot(owner, response.data?.value, response.data?.key); }
        catch { throw fail(api); }
        return [];
      }
      if (page > 1) throw fail(api);
      throw cause;
    }
    if (!Array.isArray(data?.list) || !Number.isSafeInteger(data.total) || data.total < 0 || total !== undefined && data.total !== total) throw fail(api);
    total = data.total as number;
    for (const entry of data.list) {
      try {
        const value: unknown = entry?.value;
        if (!isRecord(value)) throw fail(api);
        const copy = { ...value };
        if (owner) {
          if (kind === 'credentials') copy.username = decodeURIComponent(owner.split('/').at(-1)!);
          if (kind === 'graphqlCostDecorations') copy.service_id = decodeURIComponent(owner.split('/').at(-1)!);
        }
        const { url } = getImportRequest(kind, copy);
        validateExactResourceSnapshot(url, value, entry.key);
        if (kind === 'secrets') { const parts = url.split('/').map(decodeURIComponent); copy.manager = parts[2]; copy.id = parts[3]; }
        if (!url.startsWith(api + '/') || seen.has(url)) throw fail(api);
        seen.add(url); items.push(copy);
      } catch { throw fail(api); }
    }
    if (items.length > total || !data.list.length && items.length < total) throw fail(api);
    if (items.length === total) return items;
  }
}

async function readChildren(kind: 'credentials' | 'graphqlCostDecorations', owners: Record<string, unknown>[], catalogComplete: boolean) {
  const requested = owners.map((owner) => kind === 'credentials' ? `/consumers/${encodeURIComponent(String(owner.username))}` : `/services/${encodeURIComponent(String(owner.id))}`);
  const completed: string[] = []; const items: Record<string, unknown>[] = [];
  for (let start = 0; start < requested.length; start += 4) {
    const batch = requested.slice(start, start + 4);
    const results = await Promise.allSettled(batch.map((owner) => readExportCollection(kind, `${owner}/${kind === 'credentials' ? 'credentials' : 'graphql_cost_decorations'}`, owner)));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') { completed.push(batch[index]); items.push(...result.value); }
      else if (result.reason instanceof InvalidExportCollection) throw result.reason;
    });
  }
  const coverage: CollectionCoverage = { scope: { type: 'all' }, state: catalogComplete && requested.length === completed.length ? 'complete' : 'incomplete', count: items.length,
    owners: { requested: normalizedScopeValues(requested), completed: normalizedScopeValues(completed), catalogComplete } };
  return { items, coverage };
}

async function readMetadata() {
  const { data } = await req.get('/plugins', { ...requestConfig, params: { all: true } });
  if (!isRecord(data) || Object.values(data).some((plugin) => !isRecord(plugin))) throw fail('/plugins');
  if (Object.values(data).some((plugin) => isRecord(plugin) && plugin.metadata_schema != null && !isRecord(plugin.metadata_schema))) throw fail('/plugins');
  const names = Object.entries(data).filter(([, plugin]) => isRecord(plugin) && Object.hasOwn(plugin, 'metadata_schema') && plugin.metadata_schema != null).map(([name]) => name);
  const items: Record<string, unknown>[] = []; let complete = true;
  for (let start = 0; start < names.length; start += 4) {
    const results = await Promise.allSettled(names.slice(start, start + 4).map(async (name) => {
      const api = `/plugin_metadata/${encodeURIComponent(name)}`;
      try {
        const response = await req.get(api, requestConfig);
        try { validateExactResourceSnapshot(api, response.data?.value, response.data?.key); } catch { throw fail(api); }
        return { ...response.data.value, id: name };
      } catch (cause) { if ((cause as { response?: { status?: number } }).response?.status === 404) return null; throw cause; }
    }));
    for (const result of results) {
      if (result.status === 'fulfilled') { if (result.value) items.push(result.value); }
      else if (result.reason instanceof InvalidExportCollection) throw result.reason;
      else complete = false;
    }
  }
  return { items, coverage: { scope: { type: 'ids', values: names.map((name) => `/plugin_metadata/${encodeURIComponent(name)}`).sort() }, state: complete ? 'complete' : 'incomplete', count: items.length } as CollectionCoverage };
}

export async function readFullExport(): Promise<ExportData> {
  const resources = Object.fromEntries(IMPORT_ORDER.map((kind) => [kind, []])) as unknown as ExportData['resources'];
  const collections = Object.fromEntries(IMPORT_ORDER.map((kind) => [kind, { scope: { type: 'all' }, state: 'incomplete', count: 0 }])) as ExportCoverage['collections'];
  collections.pluginMetadata.scope = { type: 'ids', values: [] };
  const entries = Object.entries(paths) as [ResourceKey, string][];
  for (let start = 0; start < entries.length; start += 4) {
    const batch = entries.slice(start, start + 4);
    const results = await Promise.allSettled(batch.map(([kind, api]) => readExportCollection(kind, api)));
    results.forEach((result, index) => {
      const [kind] = batch[index];
      if (result.status === 'fulfilled') { resources[kind] = result.value; collections[kind] = { scope: { type: 'all' }, state: 'complete', count: result.value.length }; }
      else if (result.reason instanceof InvalidExportCollection) throw result.reason;
    });
  }
  for (const [kind, ownerKind] of [['credentials', 'consumers'], ['graphqlCostDecorations', 'services']] as const) {
    const result = await readChildren(kind, resources[ownerKind], collections[ownerKind].state === 'complete');
    resources[kind] = result.items; collections[kind] = result.coverage;
  }
  try { const metadata = await readMetadata(); resources.pluginMetadata = metadata.items; collections.pluginMetadata = metadata.coverage; }
  catch (cause) { if (cause instanceof InvalidExportCollection) throw cause; }
  return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(),
    skippedResources: IMPORT_ORDER.filter((kind) => collections[kind].state !== 'complete'), resources,
    coverage: { version: 1, mode: 'full', selectedResources: [...IMPORT_ORDER], rootUrls: [], collections } };
}
