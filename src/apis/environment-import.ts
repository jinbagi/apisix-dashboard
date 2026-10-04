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
import { SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { req } from '@/config/req';
import { isRecord } from '@/utils/apisixEditable';
import { supportedPluginReferences } from '@/utils/pluginReferences';
import { assertRestorableExport } from '@/utils/sharingFormat';

export const MAPPABLE_RESOURCES = ['routes', 'streamRoutes', 'services', 'upstreams', 'pluginConfigs', 'consumers', 'consumerGroups', 'protos'] as const;
export type MappedKind = typeof MAPPABLE_RESOURCES[number];
export type IdMappings = Partial<Record<MappedKind, Record<string, string>>>;
const apiKinds = new Map<string, string>([['streamRoutes', 'stream_routes'], ['pluginConfigs', 'plugin_configs'], ['consumerGroups', 'consumer_groups'], ['globalRules', 'global_rules']]);
const apiKind = (kind: string) => apiKinds.get(kind) ?? kind;
const mappedKind = (kind: string) => (kind === 'plugin_configs' ? 'pluginConfigs' : kind === 'consumer_groups' ? 'consumerGroups' : kind) as MappedKind;
const validRef = (id: unknown): id is string | number =>
  (typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))) && String(id).length > 0 && !['.', '..'].includes(String(id));

function readIdMappings(text: string): IdMappings {
  const input: unknown = JSON.parse(text.trim() || '{}');
  if (!isRecord(input)) throw new Error('ID mappings must be a JSON object.');
  for (const [kind, mapping] of Object.entries(input)) {
    if (!(MAPPABLE_RESOURCES as readonly string[]).includes(kind) || !isRecord(mapping)) throw new Error(`Unsupported ID mapping: ${kind}`);
    if (Object.values(mapping).some((target) => typeof target !== 'string')) throw new Error(`Invalid destination ID in ${kind}`);
  }
  return input as IdMappings;
}

export function parseIdMappings(text: string): IdMappings {
  const input = readIdMappings(text);
  for (const [kind, mapping] of Object.entries(input)) {
    const destinations = new Map<string, string>();
    for (const [source, target] of Object.entries(mapping)) {
      if (!source || ['.', '..'].includes(source)) throw new Error(`Invalid source ID in ${kind}`);
      if (typeof target !== 'string' || target.length > 64 || !/^[a-zA-Z0-9_.-]+$/.test(target) || ['.', '..'].includes(target) ||
        (kind === 'consumers' && !/^[a-zA-Z0-9_-]+$/.test(target))) throw new Error(`Invalid destination ID in ${kind}`);
      if (destinations.has(target)) throw new Error(`ID mapping collision in ${kind}: ${destinations.get(target)} and ${source} both map to ${target}`);
      destinations.set(target, source);
    }
  }
  return input as IdMappings;
}

export type EnvironmentReference = { field: string; targetKind: string; value: unknown };
export function environmentReferences(kind: ResourceKey, resource: Record<string, unknown>): EnvironmentReference[] {
  const refs: EnvironmentReference[] = [];
  const add = (field: string, targetKind: string) => { if (Object.hasOwn(resource, field) && resource[field] != null) refs.push({ field, targetKind, value: resource[field] }); };
  if (['routes', 'streamRoutes'].includes(kind)) add('service_id', 'services');
  if (['routes', 'streamRoutes', 'services'].includes(kind)) add('upstream_id', 'upstreams');
  if (kind === 'routes') add('plugin_config_id', 'plugin_configs');
  if (kind === 'consumers') add('group_id', 'consumer_groups');
  if (kind === 'credentials') add('username', 'consumers');
  if (kind === 'graphqlCostDecorations') add('service_id', 'services');
  return [...refs, ...supportedPluginReferences(apiKind(kind), resource)];
}

export function mapImportEnvironment(data: ExportData, text: string): ExportData {
  assertRestorableExport(data);
  const mappings = parseIdMappings(text);
  const resolve = (kind: MappedKind, id: unknown) => {
    if (!validRef(id)) return id;
    const map = mappings[kind]; return map && Object.hasOwn(map, String(id)) ? map[String(id)] : id;
  };
  const resources = { ...data.resources };
  for (const kind of IMPORT_ORDER) {
    if (!Object.hasOwn(data.resources, kind)) continue;
    const items: unknown = resources[kind] ?? [];
    if (!Array.isArray(items)) throw new Error(`${kind} must be an array`);
    const destinations = new Map<string, string>();
    resources[kind] = items.map((item: unknown) => {
      if (!isRecord(item)) throw new Error(`${kind} contains an invalid resource`);
      // Clone all JSON properties, including own __proto__ keys, without mutating the uploaded file.
      const copy = structuredClone(item);
      if ((MAPPABLE_RESOURCES as readonly string[]).includes(kind)) {
        const identity = kind === 'consumers' ? 'username' : 'id';
        const source = kind === 'consumers' ? item.username ?? item.id : item.id;
        if (source != null) {
          copy[identity] = resolve(kind as MappedKind, source);
          const destination = String(copy[identity]);
          if (destinations.has(destination) && destinations.get(destination) !== String(source))
            throw new Error(`ID mapping collision in ${kind}: ${destinations.get(destination)} and ${String(source)} both map to ${destination}`);
          destinations.set(destination, String(source));
        }
      }
      for (const reference of environmentReferences(kind, item)) {
        if (reference.field.startsWith('plugins.')) continue;
        copy[reference.field] = resolve(mappedKind(reference.targetKind), reference.value);
      }
      for (const reference of supportedPluginReferences(apiKind(kind), item)) {
        if (reference.value === undefined) continue;
        let parent: unknown = copy;
        for (const segment of reference.path.slice(0, -1)) parent = (parent as Record<string | number, unknown>)[segment];
        (parent as Record<string | number, unknown>)[reference.path.at(-1)!] = resolve(reference.targetKind, reference.value);
      }
      return copy;
    });
  }
  return { ...data, resources };
}

export type EnvironmentMappingRow = { key: string; kind: MappedKind; source: string; destination: string; contexts: string[] };
export function environmentMappingRows(data: ExportData, text: string): EnvironmentMappingRow[] {
  const mappings = readIdMappings(text);
  const rows = new Map<string, EnvironmentMappingRow>();
  const add = (kind: MappedKind, id: unknown, context: string) => {
    if (!validRef(id)) return;
    const source = String(id); const key = JSON.stringify([kind, source]);
    const row = rows.get(key) ?? { key, kind, source, destination: mappings[kind] && Object.hasOwn(mappings[kind]!, source) ? mappings[kind]![source] : '', contexts: [] };
    if (!row.contexts.includes(context)) row.contexts.push(context);
    rows.set(key, row);
  };
  for (const kind of IMPORT_ORDER) for (const item of data.resources[kind] ?? []) {
    if (!isRecord(item)) continue;
    if ((MAPPABLE_RESOURCES as readonly string[]).includes(kind)) add(kind as MappedKind, kind === 'consumers' ? item.username ?? item.id : item.id, 'Resource in file');
    for (const ref of environmentReferences(kind, item)) add(mappedKind(ref.targetKind), ref.value, `${kind}: ${ref.field}`);
  }
  for (const [kind, mapping] of Object.entries(mappings)) for (const source of Object.keys(mapping)) add(kind as MappedKind, source, 'Explicit JSON mapping');
  return [...rows.values()];
}

export function updateIdMapping(text: string, kind: MappedKind, source: string, destination: string) {
  const mappings = readIdMappings(text);
  const entries = Object.entries(mappings[kind] ?? {}).filter(([key]) => key !== source);
  if (destination) entries.push([source, destination]);
  const result = { ...mappings };
  if (entries.length) result[kind] = Object.fromEntries(entries); else delete result[kind];
  return JSON.stringify(result, null, 2);
}

function previewReferences(row: ImportPreviewItem): EnvironmentReference[] {
  const refs = environmentReferences(row.resourceType, row.after ?? {});
  if (['credentials', 'graphqlCostDecorations'].includes(row.resourceType) && row.url) {
    const [, kind, owner] = row.url.split('/');
    refs.push({ field: 'owner', targetKind: kind, value: decodeURIComponent(owner) });
  }
  return refs;
}

export async function verifyEnvironmentReferences(row: ImportPreviewItem, plan: ImportPreviewItem[] = [], cache = new Map<string, Promise<void>>()) {
  for (const ref of previewReferences(row)) {
    if (!validRef(ref.value)) throw new Error(`Invalid reference at ${ref.field}`);
    const target = `/${ref.targetKind}/${encodeURIComponent(String(ref.value))}`;
    const dependency = plan.find((item) => item.url === target);
    if (dependency) {
      if (dependency.status === 'Blocked') throw new Error(`Unresolved reference at ${ref.field}: ${target} is blocked`);
      continue;
    }
    let read = cache.get(target);
    if (!read) {
      read = req.get(target, { timeout: 15_000, headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] } }).then(({ data }) => {
        const value = data?.value;
        if (!isRecord(value) || String(value[ref.targetKind === 'consumers' ? 'username' : 'id']) !== String(ref.value))
          throw new Error('Destination identity could not be verified');
      });
      cache.set(target, read);
    }
    try { await read; }
    catch { throw new Error(`Unresolved reference at ${ref.field}: ${target} is missing or unreadable`); }
  }
}

export async function checkEnvironmentReferences(items: ImportPreviewItem[]) {
  const cache = new Map<string, Promise<void>>();
  // IMPORT_ORDER places supported dependencies before their dependants.
  for (const row of items) {
    if (row.status === 'Blocked') continue;
    try { await verifyEnvironmentReferences(row, items, cache); }
    catch (error) { row.status = 'Blocked'; row.error = error instanceof Error ? error.message : 'Unresolved resource reference'; }
  }
  return items;
}

export function unselectedImportDependencies(items: ImportPreviewItem[], selected: string[]) {
  const missing = new Set<string>();
  for (const row of items.filter((item) => selected.includes(item.key))) {
    const refs = environmentReferences(row.resourceType, row.after ?? {}).map((ref) => [ref.targetKind, ref.value] as const);
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
