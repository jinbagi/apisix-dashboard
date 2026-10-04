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
import { checkEnvironmentReferences, type IdMappings, mapImportEnvironment, MAPPABLE_RESOURCES } from '@/apis/environment-import';
import { type ExportData, getImportRequest, IMPORT_ORDER, type ResourceKey } from '@/apis/export-import';
import { type ImportPreviewItem, previewImport } from '@/apis/import-preview';

const cloneKinds: ResourceKey[] = ['routes', 'streamRoutes', 'services', 'upstreams', 'pluginConfigs', 'protos', 'graphqlCostDecorations'];
export type CloneDraft = { resourceType: ResourceKey; item: Record<string, unknown>; baseline: null };
export type ClonePreview = { data: ExportData; rows: ImportPreviewItem[] };

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

export function mapDependencyClone(source: ExportData, mappings: string, activateHttpRoutes = false): ExportData {
  const seen = new Set<string>();
  for (const kind of IMPORT_ORDER) for (const item of source.resources[kind] ?? []) {
    if (!cloneKinds.includes(kind)) throw new Error(`Cloning ${kind} is not supported by this dependency scope.`);
    const { url } = getImportRequest(kind, item);
    if (seen.has(url)) throw new Error(`Duplicate source resource: ${url}`);
    seen.add(url);
  }
  if (!seen.size) throw new Error('No resources were loaded for cloning.');
  const mapped = mapImportEnvironment(source, mappings);
  // HTTP Routes have an explicit disabled state. Do not invent a status for Stream Routes.
  mapped.resources.routes = mapped.resources.routes.map((item) => ({ ...item, status: activateHttpRoutes ? 1 : 0 }));
  return mapped;
}

export async function previewDependencyClone(source: ExportData, mappings: string, activateHttpRoutes = false): Promise<ClonePreview> {
  const data = mapDependencyClone(source, mappings, activateHttpRoutes);
  const rows = await previewImport(data, cloneKinds);
  for (const row of rows) {
    const original = getImportRequest(row.resourceType, source.resources[row.resourceType]![row.index]);
    row.sourceUrl = original.url; row.sourceBody = original.body;
    if (row.url === original.url) {
      row.status = 'Blocked'; row.error = 'Choose a new destination ID. A clone cannot replace its source.';
    } else if (row.status === 'Changed' || row.status === 'Unchanged') {
      row.status = 'Blocked'; row.error = 'Destination already exists. Choose a different ID; clones never overwrite existing resources.';
    }
  }
  await checkEnvironmentReferences(rows);
  return { data, rows };
}

/** Repeat the read before staging; the Change sets executor also rechecks each create-only baseline. */
export async function prepareCloneDrafts(source: ExportData, mappings: string, activateHttpRoutes = false): Promise<{ preview: ClonePreview; drafts: CloneDraft[] }> {
  const preview = await previewDependencyClone(source, mappings, activateHttpRoutes);
  if (preview.rows.some((row) => row.status !== 'New'))
    return { preview, drafts: [] };
  return { preview, drafts: preview.rows.map((row) => ({
    resourceType: row.resourceType, item: preview.data.resources[row.resourceType]![row.index], baseline: null,
  })) };
}
