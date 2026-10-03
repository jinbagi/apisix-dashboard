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

import { isRecord } from '@/utils/apisixEditable';

export type ConfigurationSource = {
  kind: 'routes' | 'services' | 'plugin_configs' | 'global_rules' | 'upstreams';
  id: string;
  value: Record<string, unknown>;
};
export type PluginOrigin = {
  name: string;
  source: ConfigurationSource;
  value: Record<string, unknown>;
  overridden: Array<{ source: ConfigurationSource; value: Record<string, unknown> }>;
  disabled: boolean;
  conditional: boolean;
};

/** APISIX merges complete plugin objects, not individual plugin properties. */
export function resolvePlugins(sources: ConfigurationSource[]): PluginOrigin[] {
  const byName = new Map<string, PluginOrigin>();
  for (const source of sources) {
    if (!isRecord(source.value.plugins)) continue;
    for (const [name, value] of Object.entries(source.value.plugins)) {
      if (!isRecord(value)) continue;
      const previous = byName.get(name);
      if (previous) previous.overridden.push({ source, value });
      else byName.set(name, { name, source, value, overridden: [],
        disabled: isRecord(value._meta) && value._meta.disable === true,
        conditional: isRecord(value._meta) && Array.isArray(value._meta.filter) && value._meta.filter.length > 0 });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveUpstream(route: ConfigurationSource, service?: ConfigurationSource) {
  // Route inline upstream clears an inherited upstream_id; a Route upstream_id wins over either.
  for (const source of [route, service]) {
    if (!source) continue;
    if (source.value.upstream_id !== undefined && source.value.upstream_id !== null)
      return { source, id: String(source.value.upstream_id), value: undefined };
    if (isRecord(source.value.upstream))
      return { source, id: undefined, value: source.value.upstream };
  }
  return undefined;
}
export function resolveSetting(name: string, route: ConfigurationSource, service?: ConfigurationSource) {
  return [route, service].find((source) => source && source.value[name] !== undefined && source.value[name] !== null);
}

