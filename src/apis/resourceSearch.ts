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
import { getResourceDetailPath, getResourceId, RESOURCES } from '@/apis/dashboard';
import { PAGE_SIZE_MAX } from '@/config/constant';
import { req } from '@/config/req';
import { isRecord } from '@/utils/apisixEditable';

export type SearchResource = (typeof RESOURCES)[number];
export type ResourceSearchItem = {
  key: string;
  resourceType: SearchResource['key'];
  id: string;
  name: string;
  context: string;
  detailPath: string;
  searchText: string;
};

export const RESOURCE_LABELS: Record<SearchResource['key'], string> = {
  routes: 'Routes', services: 'Services', upstreams: 'Upstreams',
  consumers: 'Consumers', ssls: 'SSLs', streamRoutes: 'Stream Routes',
  consumerGroups: 'Consumer Groups', globalRules: 'Global Rules',
  pluginConfigs: 'Plugin Configs', pluginMetadata: 'Plugin Metadata',
  secrets: 'Secrets', protos: 'Protos',
};

const SEARCH_FIELDS = [
  'id', 'username', 'name', 'desc', 'sni', 'snis', 'uri', 'uris', 'host',
  'hosts', 'service_id', 'upstream_id', 'plugin_config_id', 'group_id', 'manager',
] as const;

// Deliberately exclude plugin/provider bodies: keys and passwords must not
// become search snippets. Only public resource identity and routing fields.
const strings = (value: unknown): string[] => {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(strings);
  return typeof value === 'string' || typeof value === 'number' ? [String(value)] : [];
};

export function createSearchItem(
  resource: SearchResource, value: Record<string, unknown>,
): ResourceSearchItem | undefined {
  const id = getResourceId(resource.key, value);
  if (!id) return undefined;
  const name = strings(value.name)[0] || strings(value.desc)[0] || id;
  const context = [resource.key === 'secrets' ? value.manager : undefined, value.uri, value.uris, value.host, value.hosts, value.sni, value.snis]
    .flatMap(strings).join(' · ');
  const labels = isRecord(value.labels)
    ? Object.entries(value.labels).flatMap(([key, val]) => [key, ...strings(val)]) : [];
  // A Secret is identified by manager AND id, so equal ids cannot collide.
  const encodedValue: Record<string, unknown> = { ...value, id: encodeURIComponent(id) };
  if (resource.key === 'consumers') encodedValue.username = encodeURIComponent(id);
  if (resource.key === 'secrets') encodedValue.manager = encodeURIComponent(String(value.manager ?? ''));
  return {
    key: `${resource.key}:${String(value.manager ?? '')}:${id}`,
    resourceType: resource.key, id, name, context,
    detailPath: getResourceDetailPath(resource, encodedValue),
    searchText: [...SEARCH_FIELDS.flatMap((field) => strings(value[field])), ...labels]
      .join(' ').toLowerCase(),
  };
}

export function rankSearchItems(items: ResourceSearchItem[], query: string) {
  const normalized = query.trim().toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);
  const score = (item: ResourceSearchItem) => {
    const id = item.id.toLowerCase();
    const name = item.name.toLowerCase();
    if (id === normalized) return 0;
    if (name === normalized) return 1;
    if (id.startsWith(normalized) || name.startsWith(normalized)) return 2;
    return 3;
  };
  return items.filter((item) => words.every((word) => item.searchText.includes(word)))
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

export type SearchCollection = { items: ResourceSearchItem[]; incomplete: boolean };

export async function loadSearchCollection(
  resource: SearchResource, signal: AbortSignal,
): Promise<SearchCollection> {
  const items = new Map<string, ResourceSearchItem>();
  let totalPages = 1;
  // At most one outstanding page per collection. Avoid unbounded fan-out on
  // large gateways; cancellation stops pagination when the query changes.
  for (let page = 1; page <= totalPages; page++) {
    try {
      const response = await req.get(resource.api, {
        params: { page, page_size: PAGE_SIZE_MAX }, signal,
      });
      const list: unknown = response.data?.list;
      if (!Array.isArray(list)) throw new Error('Invalid resource collection');
      if (page === 1) {
        const total = response.data?.total;
        if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid resource total');
        totalPages = Math.ceil(total / PAGE_SIZE_MAX);
      }
      for (const entry of list) {
        if (!isRecord(entry) || !isRecord(entry.value)) throw new Error('Invalid resource entry');
        const item = createSearchItem(resource, entry.value);
        if (item) items.set(item.key, item);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      return { items: [...items.values()], incomplete: true };
    }
  }
  return { items: [...items.values()], incomplete: false };
}
