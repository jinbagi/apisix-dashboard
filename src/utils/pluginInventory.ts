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

export const PLUGIN_SCOPES = {
  routes: 'Routes', stream_routes: 'Stream Routes', services: 'Services',
  consumers: 'Consumers', consumer_groups: 'Consumer Groups',
  global_rules: 'Global Rules', plugin_configs: 'Plugin Configs', credentials: 'Credentials',
} as const;
export type PluginScope = keyof typeof PLUGIN_SCOPES;
export type PluginSource = { api: string; scope: PluginScope; id: string; name: string; value: Record<string, unknown> };
export type PluginInstance = PluginSource & { key: string; plugin: string; config: unknown; disabled: boolean; valid: boolean };

export function pluginInstances(sources: PluginSource[]): PluginInstance[] {
  return sources.flatMap((source) => {
    const plugins = source.value.plugins;
    if (plugins == null || (Array.isArray(plugins) && plugins.length === 0)) return [];
    if (!isRecord(plugins)) throw new Error(`Invalid plugins object at ${source.api}`);
    return Object.entries(plugins).map(([plugin, config]) => ({
      ...source, key: JSON.stringify([source.api, plugin]), plugin, config,
      valid: isRecord(config), disabled: isRecord(config) && isRecord(config._meta) && config._meta.disable === true,
    }));
  }).sort((a, b) => a.plugin.localeCompare(b.plugin) || a.api.localeCompare(b.api));
}
export function comparablePluginJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparablePluginJson);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, comparablePluginJson(value[key])]));
  return value;
}
export function summarizePlugins(rows: PluginInstance[]) {
  const plugins = new Map<string, { plugin: string; instances: number; disabled: number; variants: Set<string> }>();
  for (const row of rows) {
    const summary = plugins.get(row.plugin) ?? { plugin: row.plugin, instances: 0, disabled: 0, variants: new Set<string>() };
    summary.instances++; summary.disabled += Number(row.disabled);
    summary.variants.add(JSON.stringify(comparablePluginJson(row.config)));
    plugins.set(row.plugin, summary);
  }
  return [...plugins.values()].map(({ variants, ...summary }) => ({ ...summary, variants: variants.size }));
}
