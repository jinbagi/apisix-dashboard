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
import { API_GLOBAL_RULES, API_PLUGIN_CONFIGS, API_ROUTES, API_SERVICES, API_UPSTREAMS } from '@/config/constant';
import { req } from '@/config/req';
import { isRecord } from '@/utils/apisixEditable';
import { type ConfigurationSource, resolvePlugins, resolveSetting, resolveUpstream } from '@/utils/routeConfiguration';

async function readSource(kind: ConfigurationSource['kind'], path: string, id: string): Promise<ConfigurationSource> {
  try {
    const { data } = await req.get(`${path}/${encodeURIComponent(id)}`);
    if (!isRecord(data?.value)) throw new Error('Admin API returned no resource value');
    return { kind, id, value: data.value };
  } catch (cause) {
    throw new Error(`Unable to read ${kind}/${id}: ${cause instanceof Error ? cause.message : 'request failed'}`);
  }
}

export async function readRouteConfiguration(id: string) {
  const route = await readSource('routes', API_ROUTES, id);
  const [service, pluginConfig, globalValues] = await Promise.all([
    route.value.service_id == null ? undefined : readSource('services', API_SERVICES, String(route.value.service_id)),
    route.value.plugin_config_id == null ? undefined : readSource('plugin_configs', API_PLUGIN_CONFIGS, String(route.value.plugin_config_id)),
    fetchAllResources<Record<string, unknown>>(async (client, params) => {
      try {
        const { data } = await client.get(API_GLOBAL_RULES, { params });
        if (!Array.isArray(data?.list) || typeof data.total !== 'number' ||
          data.list.some((item: { value?: unknown }) => !isRecord(item?.value)))
          throw new Error('Admin API returned an invalid Global Rules list');
        return data;
      } catch (cause) {
        throw new Error(`Unable to read Global Rules: ${cause instanceof Error ? cause.message : 'request failed'}`);
      }
    }),
  ]);
  const sources = [route, pluginConfig, service].filter((source): source is ConfigurationSource => Boolean(source));
  const upstream = resolveUpstream(route, service);
  const upstreamResource = upstream?.id === undefined ? undefined : await readSource('upstreams', API_UPSTREAMS, upstream.id);
  const globalRules: ConfigurationSource[] = globalValues.map((value) => ({ kind: 'global_rules', id: String(value.id), value }));
  return {
    sources, plugins: resolvePlugins(sources),
    // Global rules are independently executed; never deduplicate them against local plugins or each other.
    globalPlugins: globalRules.flatMap((source) => resolvePlugins([source])),
    upstream, upstreamResource,
    script: resolveSetting('script', route, service),
    websocket: resolveSetting('enable_websocket', route, service),
    readAt: new Date().toLocaleTimeString(),
  };
}
export type RouteConfiguration = Awaited<ReturnType<typeof readRouteConfiguration>>;

