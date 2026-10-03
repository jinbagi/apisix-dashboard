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
import { SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { req } from '@/config/req';
import { isRecord } from '@/utils/apisixEditable';

export const supportsDependencyExport = (api: string) => ['/routes', '/stream_routes', '/services'].includes(api);
type Kind = 'routes' | 'stream_routes' | 'services' | 'upstreams' | 'plugin_configs';
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

export async function prepareDependencyExport(apiBase: string, selectedIds: string[]) {
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
        const response = await req.get(`/${row.kind}/${encodeURIComponent(row.id)}`, {
          timeout: 15_000, headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] },
        });
        const value: unknown = response.data?.value;
        if (!isRecord(value) || value.id == null || String(value.id) !== row.id)
          throw new Error('The API did not return the expected resource identity.');
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
    }
  }
  const items = [...rows.values()];
  const blocked = items.filter((row) => row.status !== 'Included').length;
  const data: ExportData = {
    version: EXPORT_VERSION, exportedAt: new Date().toISOString(),
    skippedResources: [DEPENDENCY_EXPORT_SCOPE], resources,
  };
  return { rows: items, blocked, data };
}
