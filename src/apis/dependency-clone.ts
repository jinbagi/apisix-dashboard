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
import { checkEnvironmentReferences, environmentReferences, type IdMappings, mapImportEnvironment, MAPPABLE_RESOURCES, parseIdMappings } from '@/apis/environment-import';
import { type ExportData, getImportRequest, IMPORT_ORDER, type ResourceKey } from '@/apis/export-import';
import { type ImportPreviewItem, previewImport } from '@/apis/import-preview';

const cloneKinds: ResourceKey[] = ['routes', 'streamRoutes', 'services', 'upstreams', 'pluginConfigs', 'protos', 'graphqlCostDecorations'];
export type CloneDraft = { resourceType: ResourceKey; item: Record<string, unknown>; baseline: null };
export type CloneChoices = { rootUrls: string[]; reusedUrls: string[] };
export type ClonePreview = { data: ExportData; rows: ImportPreviewItem[]; reusedUrls: string[]; omittedUrls: string[] };

/** Reusing an owner keeps its existing subtree; only references from cloned resources need copies. */
export function selectCloneResources(source: ExportData, choices?: CloneChoices) {
  const entries = IMPORT_ORDER.flatMap((kind) => (source.resources[kind] ?? []).map((item) => ({ kind, item, url: getImportRequest(kind, item).url })));
  const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
  if (byUrl.size !== entries.length) throw new Error('Duplicate source resource in clone.');
  if (entries.some((entry) => !cloneKinds.includes(entry.kind))) throw new Error('A resource type is not supported by this dependency scope.');
  if (!entries.length) throw new Error('No resources were loaded for cloning.');
  const roots = new Set(choices?.rootUrls ?? entries.map((entry) => entry.url));
  const reused = new Set(choices?.reusedUrls ?? []);
  if (!roots.size || [...roots].some((url) => !byUrl.has(url))) throw new Error('Selected clone roots must be resources in the loaded source.');
  for (const url of reused) {
    if (!byUrl.has(url) || roots.has(url) || byUrl.get(url)!.kind === 'graphqlCostDecorations')
      throw new Error('Only non-selected dependencies can be reused. GraphQL children follow their Service.');
  }
  const cloned = new Set<string>(); const activeReused = new Set<string>();
  const visit = (url: string) => {
    const entry = byUrl.get(url); if (!entry || cloned.has(url) || activeReused.has(url)) return;
    if (reused.has(url)) { activeReused.add(url); return; }
    cloned.add(url);
    for (const ref of environmentReferences(entry.kind, entry.item)) visit(`/${ref.targetKind}/${encodeURIComponent(String(ref.value))}`);
    if (entry.kind === 'services') for (const child of entries) {
      if (child.kind === 'graphqlCostDecorations' && child.url.startsWith(`${url}/graphql_cost_decorations/`)) visit(child.url);
    }
  };
  roots.forEach(visit);
  const resources = Object.fromEntries(IMPORT_ORDER.map((kind) => [kind, entries.filter((entry) => entry.kind === kind && cloned.has(entry.url)).map((entry) => entry.item)])) as ExportData['resources'];
  // Preserve source artifact markers so the mapping/import guards still see them.
  const data: ExportData = { ...source, resources };
  return { data, reusedUrls: [...activeReused], omittedUrls: entries.filter((entry) => !cloned.has(entry.url) && !activeReused.has(entry.url)).map((entry) => entry.url) };
}

/** Ignore mappings for dependencies outside the clone; retained references keep their exact source ID. */
export function cloneMappingText(source: ExportData, text: string, choices?: CloneChoices) {
  const selected = selectCloneResources(source, choices);
  const kept = new Set(IMPORT_ORDER.flatMap((kind) => (selected.data.resources[kind] ?? []).map((item) => getImportRequest(kind, item).url)));
  const excluded = new Set(IMPORT_ORDER.flatMap((kind) => (source.resources[kind] ?? []).filter((item) => !kept.has(getImportRequest(kind, item).url)).map((item) => JSON.stringify([kind, String(item.id)]))));
  const mappings = parseIdMappings(text);
  return JSON.stringify(Object.fromEntries(Object.entries(mappings).map(([kind, values]) => [kind, Object.fromEntries(Object.entries(values).filter(([id]) => !excluded.has(JSON.stringify([kind, id]))))])), null, 2);
}

/** Suggestions reserve all original IDs as well as earlier suggestions; availability still requires GET. */
export function suggestCloneMappings(data: ExportData): string {
  const mappings: IdMappings = {};
  for (const kind of MAPPABLE_RESOURCES) {
    const items = data.resources[kind] ?? [];
    if (!items.length) continue;
    const ids = items.map((item) => String(item[kind === 'consumers' ? 'username' : 'id']));
    const reserved = new Set(ids);
    mappings[kind] = Object.fromEntries(ids.map((id) => {
      const base = id.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 54) || 'resource';
      let candidate = `${base}-copy`; let suffix = 2;
      while (reserved.has(candidate)) candidate = `${base}-copy-${suffix++}`;
      reserved.add(candidate);
      return [id, candidate];
    }));
  }
  return JSON.stringify(mappings, null, 2);
}

export function mapDependencyClone(source: ExportData, mappings: string, activateHttpRoutes = false, choices?: CloneChoices): ExportData {
  const selected = selectCloneResources(source, choices);
  const mapped = mapImportEnvironment(selected.data, cloneMappingText(source, mappings, choices));
  // HTTP Routes have an explicit disabled state. Do not invent a status for Stream Routes.
  mapped.resources.routes = mapped.resources.routes.map((item) => ({ ...item, status: activateHttpRoutes ? 1 : 0 }));
  return mapped;
}

export async function previewDependencyClone(source: ExportData, mappings: string, activateHttpRoutes = false, choices?: CloneChoices): Promise<ClonePreview> {
  const selected = selectCloneResources(source, choices);
  const data = mapDependencyClone(source, mappings, activateHttpRoutes, choices);
  const rows = await previewImport(data, cloneKinds);
  for (const row of rows) {
    const original = getImportRequest(row.resourceType, selected.data.resources[row.resourceType]![row.index]);
    row.sourceUrl = original.url; row.sourceBody = original.body;
    if (row.url === original.url) {
      row.status = 'Blocked'; row.error = 'Choose a new destination ID. A clone cannot replace its source.';
    } else if (row.status === 'Changed' || row.status === 'Unchanged') {
      row.status = 'Blocked'; row.error = 'Destination already exists. Choose a different ID; clones never overwrite existing resources.';
    }
  }
  // Reused resources are external references. This verifies exact identity now and again at staging;
  // Change sets runs the same validator immediately before applying each dependent resource.
  await checkEnvironmentReferences(rows);
  return { data, rows, reusedUrls: selected.reusedUrls, omittedUrls: selected.omittedUrls };
}

/** Repeat the read before staging; the Change sets executor also rechecks each create-only baseline. */
export async function prepareCloneDrafts(source: ExportData, mappings: string, activateHttpRoutes = false, choices?: CloneChoices): Promise<{ preview: ClonePreview; drafts: CloneDraft[] }> {
  const preview = await previewDependencyClone(source, mappings, activateHttpRoutes, choices);
  if (preview.rows.some((row) => row.status !== 'New'))
    return { preview, drafts: [] };
  return { preview, drafts: preview.rows.map((row) => ({
    resourceType: row.resourceType, item: preview.data.resources[row.resourceType]![row.index], baseline: null,
  })) };
}
