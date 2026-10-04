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

import { EXPORT_VERSION, type ExportData, getExportResourceKey } from '@/apis/export-import';
import { graphqlCostDecorationsApi } from '@/apis/graphql_cost_decorations';
import { SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { req } from '@/config/req';
import { isRecord } from '@/utils/apisixEditable';
import { supportedPluginReferences } from '@/utils/pluginReferences';
import { validateExactResourceSnapshot } from '@/utils/resourceIdentity';

export const supportsDependencyExport = (api: string) => ['/routes', '/stream_routes', '/services'].includes(api);
type Kind = 'routes' | 'stream_routes' | 'services' | 'upstreams' | 'plugin_configs' | 'protos' | 'graphql_cost_decorations';
export type DependencyExportRow = {
  key: string;
  kind: Kind;
  id: string;
  reasons: string[];
  status: 'Pending' | 'Included' | 'Missing' | 'Unreadable';
  error?: string;
};
export const DEPENDENCY_EXPORT_SCOPE =
  'Follows top-level service_id, upstream_id and plugin_config_id references only. Plugin-internal references, Secrets, Consumers, credentials, SSLs, Global Rules, plugin metadata and Service child collections are not included.';

export type DependencyExportOptions = { graphqlCostDecorations?: boolean; pluginReferences?: boolean };
export const dependencyExportScope = (options: DependencyExportOptions) => {
  if (!options.graphqlCostDecorations && !options.pluginReferences) return DEPENDENCY_EXPORT_SCOPE;
  return 'Follows top-level service_id, upstream_id and plugin_config_id references. ' +
    (options.graphqlCostDecorations ? 'Includes Service GraphQL cost decorations. ' : 'Service child collections are excluded. ') +
    (options.pluginReferences ? 'Also follows grpc-transcode.proto_id and traffic-split.rules[].weighted_upstreams[].upstream_id. Other plugin-internal references are excluded. ' : 'Plugin-internal references are excluded. ') +
    'Secrets, Consumers, credentials, SSLs, Global Rules and plugin metadata are not included.';
};

async function readDecorations(serviceId: string) {
  const items: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  let total: number | undefined;
  for (let page = 1; ; page++) {
    let data;
    try {
      ({ data } = await req.get(graphqlCostDecorationsApi(serviceId), {
        params: { page, page_size: 100 }, timeout: 15_000,
        headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] },
      }));
    } catch (error) {
      if (page !== 1 || (error as { response?: { status?: number } }).response?.status !== 404) throw error;
      // APISIX returns 404 for an empty collection, but a deleted owner must not look empty.
      const ownerApi = `/services/${encodeURIComponent(serviceId)}`;
      const owner = await req.get(ownerApi, { timeout: 15_000 });
      validateExactResourceSnapshot(ownerApi, owner.data?.value, owner.data?.key);
      return [];
    }
    if (!Array.isArray(data?.list) || !Number.isSafeInteger(data.total) || data.total < 0 ||
      (total !== undefined && total !== data.total)) throw new Error('GraphQL collection returned an invalid or changing total. Refresh the preview.');
    total = data.total as number;
    for (const item of data.list) {
      const value: unknown = item?.value;
      if (!isRecord(value) || !['string', 'number'].includes(typeof value.id) || !String(value.id) ||
        ['.', '..'].includes(String(value.id)) || ids.has(String(value.id)) ||
        (value.service_id != null && String(value.service_id) !== serviceId)) throw new Error('GraphQL collection returned an invalid, duplicate or mismatched identity.');
      validateExactResourceSnapshot(`${graphqlCostDecorationsApi(serviceId)}/${encodeURIComponent(String(value.id))}`, value, item.key);
      ids.add(String(value.id));
      items.push({ ...value, id: String(value.id), service_id: serviceId });
    }
    if (items.length > total || (!data.list.length && items.length < total)) throw new Error('GraphQL collection is incomplete. Refresh the preview.');
    if (items.length === total) return items;
  }
}

export async function prepareDependencyExport(apiBase: string, selectedIds: string[], options: DependencyExportOptions = {}) {
  if (!supportsDependencyExport(apiBase) || !selectedIds.length) throw new Error('Select Routes, Stream Routes or Services to export with dependencies.');
  const resources: ExportData['resources'] = {
    upstreams: [], services: [], graphqlCostDecorations: [], routes: [], streamRoutes: [],
    consumers: [], credentials: [], consumerGroups: [], ssls: [], globalRules: [],
    pluginConfigs: [], pluginMetadata: [], protos: [], secrets: [],
  };
  const rows = new Map<string, DependencyExportRow>();
  const queue: DependencyExportRow[] = [];
  const add = (kind: Kind, value: unknown, reason: string) => {
    const valid = (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) &&
      String(value).length > 0 && !['.', '..'].includes(String(value));
    const id = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const key = `${kind}/${id}`;
    const existing = rows.get(key);
    if (existing) { if (!existing.reasons.includes(reason)) existing.reasons.push(reason); return; }
    const row: DependencyExportRow = { key, kind, id, reasons: [reason], status: valid ? 'Pending' : 'Unreadable' };
    rows.set(key, row);
    if (valid) queue.push(row); else row.error = 'Invalid resource reference; no request was sent.';
  };
  for (const id of selectedIds) add(apiBase.slice(1) as Kind, id, 'Selected resource');
  for (let offset = 0; offset < queue.length;) {
    // Fix the batch before appending dependencies so every queued resource is read exactly once.
    const batch = queue.slice(offset, offset + 4);
    offset += batch.length;
    const read = await Promise.all(batch.map(async (row) => {
      try {
        const api = `/${row.kind}/${encodeURIComponent(row.id)}`;
        const response = await req.get(api, {
          timeout: 15_000, headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] },
        });
        const value: unknown = response.data?.value;
        validateExactResourceSnapshot(api, value, response.data?.key);
        row.status = 'Included';
        const exported: Record<string, unknown> = { ...value, id: row.id };
        return { row, value: exported };
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        row.status = status === 404 ? 'Missing' : 'Unreadable';
        row.error = status === 404 ? 'Referenced resource does not exist.' : error instanceof Error ? error.message : 'Could not read resource.';
        return { row, value: undefined };
      }
    }));
    for (const { row, value } of read) {
      if (!value) continue;
      const key = getExportResourceKey(`/${row.kind}`)!;
      resources[key]!.push(value);
      if (row.kind === 'routes' || row.kind === 'stream_routes') {
        if (value.service_id != null) add('services', value.service_id, `${row.key} → service_id`);
        if (value.upstream_id != null) add('upstreams', value.upstream_id, `${row.key} → upstream_id`);
        if (row.kind === 'routes' && value.plugin_config_id != null) add('plugin_configs', value.plugin_config_id, `${row.key} → plugin_config_id`);
      }
      if (row.kind === 'services' && value.upstream_id != null) add('upstreams', value.upstream_id, `${row.key} → upstream_id`);
      if (options.pluginReferences) for (const reference of supportedPluginReferences(row.kind, value)) {
        add(reference.targetKind, reference.value, `${row.key} → ${reference.field.replace(/^plugins\./, '')}`);
      }
      if (options.graphqlCostDecorations && row.kind === 'services') {
        const collectionKey = `${row.key}/graphql_cost_decorations`;
        try {
          const decorations = await readDecorations(row.id);
          for (const decoration of decorations) {
            resources.graphqlCostDecorations!.push(decoration);
            const key = `${collectionKey}/${decoration.id}`;
            rows.set(key, { key, kind: 'graphql_cost_decorations', id: String(decoration.id), status: 'Included', reasons: [`${row.key} → child collection`] });
          }
        } catch (error) {
          rows.set(collectionKey, { key: collectionKey, kind: 'graphql_cost_decorations', id: row.id,
            status: 'Unreadable', reasons: [`${row.key} → child collection`],
            error: error instanceof Error ? error.message : 'Could not read the complete child collection.' });
        }
      }
    }
  }
  const items = [...rows.values()];
  const blocked = items.filter((row) => row.status !== 'Included').length;
  const data: ExportData = {
    version: EXPORT_VERSION, exportedAt: new Date().toISOString(),
    skippedResources: [dependencyExportScope(options)], resources,
  };
  return { rows: items, blocked, data };
}
