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
import { req } from '@/config/req';
import { isRecord } from '@/utils/apisixEditable';

export type ImpactKind = 'services' | 'upstreams' | 'plugin_configs';
export type ImpactRow = { key: string; kind: 'routes' | 'stream_routes'; id: string; name: string; path: string[]; referenceOnly: boolean };
const hasId = (value: unknown, id: string) => value !== undefined && value !== null && String(value) === id;
const hasOverride = (value: Record<string, unknown>) => value.upstream_id != null || isRecord(value.upstream);
export const impactTarget = (api: string): { kind: ImpactKind; id: string } | undefined => {
  const match = api.match(/^\/(services|upstreams|plugin_configs)\/([^/]+)$/);
  return match ? { kind: match[1] as ImpactKind, id: decodeURIComponent(match[2]) } : undefined;
};

async function readCollection(kind: string) {
  return fetchAllResources<Record<string, unknown>>(async (client, params) => {
    const { data } = await client.get(`/${kind}`, { params });
    if (!Array.isArray(data?.list) || !Number.isFinite(data.total) || data.total < 0 ||
      data.list.some((item: { value?: unknown }) => !isRecord(item?.value) || item.value.id == null))
      throw new Error(`Invalid ${kind} collection; impact could not be verified`);
    return data;
  });
}

export async function getConfigurationImpact(kind: ImpactKind, id: string) {
  const source = await req.get(`/${kind}/${encodeURIComponent(id)}`);
  if (!isRecord(source.data?.value)) throw new Error('The source resource is unavailable');
  const [routes, streams, services] = await Promise.all([
    readCollection('routes'),
    kind === 'plugin_configs' ? [] : readCollection('stream_routes'),
    kind === 'upstreams' ? readCollection('services') : [],
  ]);
  const rows: ImpactRow[] = [];
  for (const [routeKind, items] of [['routes', routes], ['stream_routes', streams]] as const) {
    for (const route of items) {
      const routeLabel = `${routeKind}/${route.id}`;
      const add = (path: string[], referenceOnly = false) => rows.push({
        key: path.join(' → '), kind: routeKind, id: String(route.id),
        name: String(route.name || route.id), path, referenceOnly,
      });
      if (kind === 'services' && hasId(route.service_id, id)) add([routeLabel, `services/${id}`]);
      if (kind === 'plugin_configs' && hasId(route.plugin_config_id, id)) add([routeLabel, `plugin_configs/${id}`]);
      if (kind === 'upstreams') {
        if (hasId(route.upstream_id, id)) add([routeLabel, `upstreams/${id}`]);
        for (const service of services) {
          if (hasId(service.upstream_id, id) && hasId(route.service_id, String(service.id)))
            add([routeLabel, `services/${service.id}`, `upstreams/${id}`], hasOverride(route));
        }
      }
    }
  }
  return { rows, readAt: new Date().toLocaleTimeString(),
    affected: new Set(rows.filter((row) => !row.referenceOnly).map((row) => `${row.kind}/${row.id}`)).size,
    services: services.filter((service) => hasId(service.upstream_id, id)).map((service) => String(service.id)) };
}

