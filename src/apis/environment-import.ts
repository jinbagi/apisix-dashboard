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
import { type ExportData, IMPORT_ORDER, type ResourceKey } from '@/apis/export-import';
import type { ImportPreviewItem } from '@/apis/import-preview';
import { isRecord } from '@/utils/apisixEditable';

const mappable = ['routes', 'streamRoutes', 'services', 'upstreams', 'pluginConfigs', 'consumers', 'consumerGroups'] as const;
type MappedKind = typeof mappable[number];
export function mapImportEnvironment(data: ExportData, text: string): ExportData {
  const input: unknown = JSON.parse(text || '{}');
  if (!isRecord(input)) throw new Error('ID mappings must be a JSON object.');
  const mappings: Partial<Record<MappedKind, Record<string, string>>> = {};
  for (const [kind, mapping] of Object.entries(input)) {
    if (!(mappable as readonly string[]).includes(kind) || !isRecord(mapping)) throw new Error(`Unsupported ID mapping: ${kind}`);
    for (const target of Object.values(mapping)) {
      if (typeof target !== 'string' || target.length > 64 || !/^[a-zA-Z0-9_.-]+$/.test(target) || ['.', '..'].includes(target) ||
        (kind === 'consumers' && !/^[a-zA-Z0-9_-]+$/.test(target))) throw new Error(`Invalid destination ID in ${kind}`);
    }
    mappings[kind as MappedKind] = mapping as Record<string, string>;
  }
  const resolve = (kind: MappedKind, id: unknown) => {
    const map = mappings[kind]; return map && Object.hasOwn(map, String(id)) ? map[String(id)] : id;
  };
  const resources = { ...data.resources };
  for (const kind of IMPORT_ORDER) {
    const items: unknown = resources[kind] ?? [];
    if (!Array.isArray(items)) throw new Error(`${kind} must be an array`);
    resources[kind] = items.map((item: unknown) => {
      if (!isRecord(item)) throw new Error(`${kind} contains an invalid resource`);
      const copy = { ...item };
      if ((mappable as readonly string[]).includes(kind)) {
        if (kind === 'consumers') copy.username = resolve('consumers', item.username ?? item.id);
        else if (item.id != null) copy.id = resolve(kind as MappedKind, item.id);
      }
      if (['routes', 'streamRoutes'].includes(kind) && item.service_id != null) copy.service_id = resolve('services', item.service_id);
      if (['routes', 'streamRoutes', 'services'].includes(kind) && item.upstream_id != null) copy.upstream_id = resolve('upstreams', item.upstream_id);
      if (kind === 'routes' && item.plugin_config_id != null) copy.plugin_config_id = resolve('pluginConfigs', item.plugin_config_id);
      if (kind === 'consumers' && item.group_id != null) copy.group_id = resolve('consumerGroups', item.group_id);
      if (kind === 'credentials' && item.username != null) copy.username = resolve('consumers', item.username);
      if (kind === 'graphqlCostDecorations' && item.service_id != null) copy.service_id = resolve('services', item.service_id);
      return copy;
    });
  }
  return { ...data, resources };
}

export function unselectedImportDependencies(items: ImportPreviewItem[], selected: string[]) {
  const missing = new Set<string>();
  for (const row of items.filter((item) => selected.includes(item.key))) {
    const body = row.after ?? {};
    const refs: Array<[string, unknown]> = [];
    if (['routes', 'streamRoutes'].includes(row.resourceType)) refs.push(['services', body.service_id]);
    if (['routes', 'streamRoutes', 'services'].includes(row.resourceType)) refs.push(['upstreams', body.upstream_id]);
    if (row.resourceType === 'routes') refs.push(['plugin_configs', body.plugin_config_id]);
    if (row.resourceType === 'consumers') refs.push(['consumer_groups', body.group_id]);
    // Child owner identity is encoded in the destination URL, not the PUT body.
    if (['credentials', 'graphqlCostDecorations'].includes(row.resourceType) && row.url) {
      const owner = items.find((item) => item.url === row.url!.split('/').slice(0, 3).join('/'));
      if (owner?.status === 'New' && !selected.includes(owner.key)) missing.add(owner.url!);
    }
    for (const [kind, id] of refs) {
      if (id == null) continue;
      const target = `/${kind}/${encodeURIComponent(String(id))}`;
      const dependency = items.find((item) => item.url === target);
      if (dependency?.status === 'New' && !selected.includes(dependency.key)) missing.add(target);
    }
  }
  return [...missing];
}

export function selectImportItems(data: ExportData, items: ImportPreviewItem[], selected: string[]) {
  const resources = { ...data.resources };
  const rows = new Map<ResourceKey, ImportPreviewItem[]>();
  for (const kind of IMPORT_ORDER) {
    const included = items.filter((row) => row.resourceType === kind && (['Blocked', 'Unchanged'].includes(row.status) || selected.includes(row.key)));
    rows.set(kind, included);
    resources[kind] = included.map((row) => data.resources[kind]![row.index]);
  }
  return { data: { ...data, resources }, rows };
}
