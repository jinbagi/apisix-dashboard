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
import { API_CONSUMER_GROUPS, API_CONSUMERS, API_GLOBAL_RULES, API_PLUGIN_CONFIGS, API_ROUTES, API_SERVICES, API_UPSTREAMS } from '@/config/constant';
import { req } from '@/config/req';
import { isRecord } from '@/utils/apisixEditable';
import { type ConfigurationSource, resolvePlugins, resolveSetting, resolveUpstream } from '@/utils/routeConfiguration';

const validId = (id: unknown): id is string | number =>
  (typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))) &&
  String(id).length > 0 && !['.', '..'].includes(String(id));

async function readSource(kind: ConfigurationSource['kind'], path: string, id: unknown): Promise<ConfigurationSource> {
  try {
    if (!validId(id)) throw new Error('Invalid resource identity');
    const { data } = await req.get(`${path}/${encodeURIComponent(String(id))}`, { timeout: 15_000 });
    const value: unknown = data?.value;
    const identity = isRecord(value) ? value[kind === 'consumers' ? 'username' : 'id'] : undefined;
    if (!isRecord(value) || !validId(identity) || String(identity) !== String(id))
      throw new Error('Admin API did not return the requested resource identity');
    return { kind, id: String(id), value };
  } catch (cause) {
    throw new Error(`Unable to read ${kind}/${String(id)}: ${cause instanceof Error ? cause.message : 'request failed'}`);
  }
}

async function readCollection(path: string, identity: 'id' | 'username', label: string) {
  try {
    let expected: number | undefined;
    const values = await fetchAllResources<Record<string, unknown>>(async (client, params) => {
      const { data } = await client.get(path, { params, timeout: 15_000 });
      if (!Array.isArray(data?.list) || !Number.isSafeInteger(data.total) || data.total < 0 ||
          (expected !== undefined && data.total !== expected) ||
          data.list.some((item: { value?: unknown }) => !isRecord(item?.value) || !validId(item.value[identity])))
        throw new Error('Invalid or changing collection response');
      expected = data.total;
      return data;
    });
    if (values.length !== expected || new Set(values.map((value) => String(value[identity]))).size !== values.length)
      throw new Error('Incomplete or duplicate collection response; refresh sources');
    return values;
  } catch (cause) {
    throw new Error(`Unable to read ${label}: ${cause instanceof Error ? cause.message : 'request failed'}`);
  }
}

export async function readConsumerUsernames() {
  const values = await readCollection(API_CONSUMERS, 'username', 'Consumers');
  // Keep only identities in the selector cache, never Consumer plugin or credential payloads.
  return values.map((value) => String(value.username)).sort((a, b) => a.localeCompare(b));
}

export async function readRouteConfiguration(id: string, consumerUsername?: string) {
  const route = await readSource('routes', API_ROUTES, id);
  const [service, pluginConfig, globalValues, consumer] = await Promise.all([
    route.value.service_id == null ? undefined : readSource('services', API_SERVICES, route.value.service_id),
    route.value.plugin_config_id == null ? undefined : readSource('plugin_configs', API_PLUGIN_CONFIGS, route.value.plugin_config_id),
    readCollection(API_GLOBAL_RULES, 'id', 'Global Rules'),
    consumerUsername ? readSource('consumers', API_CONSUMERS, consumerUsername) : undefined,
  ]);
  const consumerGroup = consumer?.value.group_id == null ? undefined
    : await readSource('consumer_groups', API_CONSUMER_GROUPS, consumer.value.group_id);
  const sources = [consumer, consumerGroup, route, pluginConfig, service].filter((source): source is ConfigurationSource => Boolean(source));
  const upstream = resolveUpstream(route, service);
  const upstreamResource = upstream?.id === undefined ? undefined : await readSource('upstreams', API_UPSTREAMS, upstream.id);
  const globalRules: ConfigurationSource[] = globalValues.map((value) => ({ kind: 'global_rules', id: String(value.id), value }));
  return {
    sources, consumerUsername: consumer?.id, plugins: resolvePlugins(sources),
    // Global rules are independently executed; never deduplicate them against local plugins or each other.
    globalPlugins: globalRules.flatMap((source) => resolvePlugins([source])),
    upstream, upstreamResource,
    script: resolveSetting('script', route, service),
    websocket: resolveSetting('enable_websocket', route, service),
    readAt: new Date().toLocaleTimeString(),
  };
}
export type RouteConfiguration = Awaited<ReturnType<typeof readRouteConfiguration>>;

