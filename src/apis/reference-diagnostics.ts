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

import { fetchAllResources } from '@/apis/fetchAll';
import { isRecord } from '@/utils/apisixEditable';

const kinds = ['routes', 'stream_routes', 'services', 'upstreams', 'plugin_configs', 'consumers', 'consumer_groups', 'global_rules', 'protos'] as const;
const pluginKinds = new Set<Kind>(['routes', 'stream_routes', 'services', 'plugin_configs', 'consumers', 'consumer_groups', 'global_rules']);
type Kind = typeof kinds[number];
export type ReferenceIssue = {
  key: string; source: string; field: string; target: string; affected: string[];
  status: 'Missing' | 'Invalid reference' | 'Not verified';
};
const identity = (kind: Kind, value: Record<string, unknown>) => kind === 'consumers' ? value.username : value.id;
const validId = (value: unknown): value is string | number =>
  (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) &&
  String(value).length > 0 && !['.', '..'].includes(String(value));
const references: Partial<Record<Kind, Array<[string, Kind]>>> = {
  routes: [['service_id', 'services'], ['upstream_id', 'upstreams'], ['plugin_config_id', 'plugin_configs']],
  stream_routes: [['service_id', 'services'], ['upstream_id', 'upstreams']],
  services: [['upstream_id', 'upstreams']], consumers: [['group_id', 'consumer_groups']],
};
type SavedReference = { field: string; targetKind: Kind; value: unknown };
function savedReferences(kind: Kind, resource: Record<string, unknown>): SavedReference[] {
  const found: SavedReference[] = (references[kind] ?? [])
    .filter(([field]) => resource[field] != null)
    .map(([field, targetKind]) => ({ field, targetKind, value: resource[field] }));
  if (!pluginKinds.has(kind) || !isRecord(resource.plugins)) return found;
  const grpc = resource.plugins['grpc-transcode'];
  if (isRecord(grpc)) found.push({ field: 'plugins.grpc-transcode.proto_id', targetKind: 'protos', value: grpc.proto_id });
  const split = resource.plugins['traffic-split'];
  if (isRecord(split) && Array.isArray(split.rules)) split.rules.forEach((rule, ruleIndex) => {
    if (isRecord(rule) && Array.isArray(rule.weighted_upstreams)) rule.weighted_upstreams.forEach((upstream, index) => {
      // Inline upstreams and the fallback to the Route's upstream do not contain an ID reference.
      if (isRecord(upstream) && Object.hasOwn(upstream, 'upstream_id')) found.push({
        field: `plugins.traffic-split.rules[${ruleIndex}].weighted_upstreams[${index}].upstream_id`,
        targetKind: 'upstreams', value: upstream.upstream_id,
      });
    });
  });
  return found;
}
function affectedRoutes(kind: Kind, resource: Record<string, unknown>, source: string, data: Map<Kind, Record<string, unknown>[]>) {
  if (kind === 'routes' || kind === 'stream_routes') return [source];
  if (kind === 'services') return (['routes', 'stream_routes'] as const).flatMap((routeKind) => (data.get(routeKind) ?? [])
    .filter((route) => route.service_id != null && String(route.service_id) === String(resource.id))
    .map((route) => `/${routeKind}/${encodeURIComponent(String(route.id))}`));
  if (kind === 'plugin_configs') return (data.get('routes') ?? [])
    .filter((route) => route.plugin_config_id != null && String(route.plugin_config_id) === String(resource.id))
    .map((route) => `/routes/${encodeURIComponent(String(route.id))}`);
  if (kind === 'global_rules') return (data.get('routes') ?? []).map((route) => `/routes/${encodeURIComponent(String(route.id))}`);
  // Consumer and Consumer Group plugins depend on the authenticated request, not a saved Route reference.
  return [];
}
async function readCollection(kind: Kind) {
  let expected: number | undefined;
  const values = await fetchAllResources<Record<string, unknown>>(async (client, params) => {
    const { data } = await client.get(`/${kind}`, { params, timeout: 15_000 });
    if (!Array.isArray(data?.list) || !Number.isSafeInteger(data.total) || data.total < 0 ||
        (expected !== undefined && expected !== data.total) ||
        data.list.some((item: { value?: unknown }) => !isRecord(item?.value) || !validId(identity(kind, item.value))))
      throw new Error('Incomplete or invalid collection response');
    expected = data.total;
    return data;
  });
  if (values.length !== expected || new Set(values.map((item) => String(identity(kind, item)))).size !== values.length)
    throw new Error('The resource list changed while reading it. Run the check again.');
  return values;
}
export async function diagnoseReferences() {
  const results = await Promise.allSettled(kinds.map(readCollection));
  const data = new Map<Kind, Record<string, unknown>[]>();
  const unavailable: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') data.set(kinds[index], result.value);
    else unavailable.push(kinds[index]);
  });
  const ids = new Map([...data].map(([kind, values]) => [kind, new Set(values.map((item) => String(identity(kind, item))))]));
  const issues: ReferenceIssue[] = [];
  for (const [kind, values] of data) for (const value of values) {
    const source = `/${kind}/${encodeURIComponent(String(identity(kind, value)))}`;
    for (const { field, targetKind, value: ref } of savedReferences(kind, value)) {
      const valid = validId(ref);
      const status = !valid ? 'Invalid reference' : !ids.has(targetKind) ? 'Not verified' : !ids.get(targetKind)!.has(String(ref)) ? 'Missing' : undefined;
      if (!status) continue;
      issues.push({ key: `${source}:${field}`, source, field,
        target: `/${targetKind}/${valid ? String(ref) : JSON.stringify(ref) ?? '(missing)'}`, status,
        affected: affectedRoutes(kind, value, source, data) });
    }
  }
  return { issues, unavailable, checkedAt: new Date().toLocaleTimeString() };
}
