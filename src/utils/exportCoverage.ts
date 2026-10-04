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
import type { ResourceKey } from '@/apis/export-import';
import { isRecord } from '@/utils/apisixEditable';

export type ExportScope = { type: 'all' } | { type: 'ids' | 'owners'; values: string[] } | { type: 'excluded' };
export type CollectionCoverage = {
  scope: ExportScope; state: 'complete' | 'incomplete' | 'excluded'; count: number;
  owners?: { requested: string[]; completed: string[]; catalogComplete: boolean };
};
export type ExportCoverage = {
  version: 1; mode: 'full' | 'selected' | 'dependencies'; selectedResources: ResourceKey[]; rootUrls: string[];
  collections: Record<ResourceKey, CollectionCoverage>; referencePaths?: string[];
};
export const normalizedScopeValues = (values: string[]) => [...new Set(values)].sort();
export const scopeKey = (scope: ExportScope) => JSON.stringify(scope.type === 'ids' || scope.type === 'owners' ? { type: scope.type, values: normalizedScopeValues(scope.values) } : scope);
export const excludedCoverage = (): CollectionCoverage => ({ scope: { type: 'excluded' }, state: 'excluded', count: 0 });
const resourcePaths: Record<ResourceKey, string> = { routes: 'routes', streamRoutes: 'stream_routes', services: 'services', upstreams: 'upstreams', consumers: 'consumers', consumerGroups: 'consumer_groups', pluginConfigs: 'plugin_configs', pluginMetadata: 'plugin_metadata', protos: 'protos', ssls: 'ssls', globalRules: 'global_rules', secrets: 'secrets', credentials: 'consumers', graphqlCostDecorations: 'services' };
function validScopeUrl(kind: ResourceKey, value: string, owner = false) {
  try {
    const parts = value.split('/').slice(1);
    const child = kind === 'credentials' ? 'credentials' : kind === 'graphqlCostDecorations' ? 'graphql_cost_decorations' : undefined;
    if (!value.startsWith('/') || parts[0] !== resourcePaths[kind] || parts.length !== (owner ? 2 : child ? 4 : kind === 'secrets' ? 3 : 2)) return false;
    if (owner && !child || !owner && child && parts[2] !== child) return false;
    return parts.every((part, index) => index === 0 || child && index === 2 ? true : part.length > 0 && !['.', '..'].includes(decodeURIComponent(part)) && encodeURIComponent(decodeURIComponent(part)) === part);
  } catch { return false; }
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((entry) => typeof entry === 'string') && new Set(value).size === value.length; }

/** Reject contradictory new metadata; older files are handled as unknown coverage by the caller. */
export function readExportCoverage(input: unknown, kinds: readonly ResourceKey[]): ExportCoverage {
  if (!isRecord(input) || input.version !== 1 || typeof input.mode !== 'string' || !['full', 'selected', 'dependencies'].includes(input.mode) ||
    !strings(input.selectedResources) || input.selectedResources.some((kind) => !kinds.includes(kind as ResourceKey)) ||
    !strings(input.rootUrls) || !isRecord(input.collections)) throw new Error('Invalid export coverage metadata.');
  for (const key of Object.keys(input.collections)) if (!kinds.includes(key as ResourceKey)) throw new Error(`Unsupported coverage collection: ${key}`);
  for (const kind of kinds) {
    const item = input.collections[kind];
    if (!isRecord(item) || !isRecord(item.scope) || typeof item.state !== 'string' || !['complete', 'incomplete', 'excluded'].includes(item.state) || !Number.isSafeInteger(item.count) || Number(item.count) < 0)
      throw new Error(`Invalid coverage for ${kind}`);
    const scope = item.scope;
    if (typeof scope.type !== 'string') throw new Error(`Invalid coverage scope for ${kind}`);
    const scopeType = scope.type;
    if (Object.keys(scope).some((key) => !(['ids', 'owners'].includes(scopeType) ? ['type', 'values'] : ['type']).includes(key))) throw new Error(`Unsupported scope fields for ${kind}`);
    if (!['all', 'ids', 'owners', 'excluded'].includes(scopeType) ||
      (['ids', 'owners'].includes(scopeType) && (!strings(scope.values) || scope.values.some((url) => !validScopeUrl(kind, url, scope.type === 'owners')))))
      throw new Error(`Invalid coverage scope for ${kind}`);
    if ((scope.type === 'excluded') !== (item.state === 'excluded') || (item.state === 'excluded' && item.count !== 0) ||
      (item.state !== 'excluded') !== input.selectedResources.includes(kind)) throw new Error(`Contradictory coverage for ${kind}`);
    if (input.mode === 'full' && scope.type !== (kind === 'pluginMetadata' ? 'ids' : 'all') || input.mode === 'selected' && !['ids', 'excluded'].includes(scopeType) || input.mode === 'dependencies' && scope.type === 'all') throw new Error(`Scope does not match export mode for ${kind}`);
    if (Object.hasOwn(item, 'owners')) {
      const owners = item.owners;
      if (!isRecord(owners) || !strings(owners.requested) || !strings(owners.completed) || typeof owners.catalogComplete !== 'boolean' ||
        owners.requested.some((url) => !validScopeUrl(kind, url, true)) || owners.completed.some((url) => !(owners.requested as string[]).includes(url))) throw new Error(`Invalid owner coverage for ${kind}`);
      if (item.state === 'complete' && (owners.completed.length !== owners.requested.length || scope.type === 'all' && !owners.catalogComplete)) throw new Error(`Incomplete owner reads for ${kind}`);
      if (scope.type === 'owners' && scopeKey({ type: 'owners', values: owners.requested }) !== scopeKey(scope as ExportScope)) throw new Error(`Mismatched owner scope for ${kind}`);
    } else if (scope.type === 'owners' || item.state !== 'excluded' && ['credentials', 'graphqlCostDecorations'].includes(kind)) throw new Error(`Missing owner coverage for ${kind}`);
  }
  if (Object.hasOwn(input, 'referencePaths') && !strings(input.referencePaths)) throw new Error('Invalid reference coverage.');
  if (input.rootUrls.some((url) => !kinds.some((kind) => validScopeUrl(kind, url)))) throw new Error('Invalid export root identity.');
  return input as unknown as ExportCoverage;
}
