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

export type SupportedPluginReference = {
  field: string;
  path: (string | number)[];
  targetKind: 'protos' | 'upstreams';
  value: unknown;
};
const sourceKinds = new Set(['routes', 'stream_routes', 'services', 'plugin_configs', 'consumers', 'consumer_groups', 'global_rules']);
const own = (record: Record<string, unknown>, key: string) => Object.hasOwn(record, key) ? record[key] : undefined;

/** Only these saved plugin paths are understood; arbitrary plugin fields are never guessed. */
export function supportedPluginReferences(sourceKind: string, resource: Record<string, unknown>): SupportedPluginReference[] {
  const plugins = own(resource, 'plugins');
  if (!sourceKinds.has(sourceKind) || !isRecord(plugins)) return [];
  const found: SupportedPluginReference[] = [];
  const grpc = own(plugins, 'grpc-transcode');
  if (isRecord(grpc)) found.push({ field: 'plugins.grpc-transcode.proto_id',
    path: ['plugins', 'grpc-transcode', 'proto_id'], targetKind: 'protos', value: own(grpc, 'proto_id') });
  const split = own(plugins, 'traffic-split');
  const rules = isRecord(split) ? own(split, 'rules') : undefined;
  if (Array.isArray(rules)) rules.forEach((rule, ruleIndex) => {
    const upstreams = isRecord(rule) ? own(rule, 'weighted_upstreams') : undefined;
    if (Array.isArray(upstreams)) upstreams.forEach((upstream, index) => {
      if (isRecord(upstream) && Object.hasOwn(upstream, 'upstream_id')) found.push({
        field: `plugins.traffic-split.rules[${ruleIndex}].weighted_upstreams[${index}].upstream_id`,
        path: ['plugins', 'traffic-split', 'rules', ruleIndex, 'weighted_upstreams', index, 'upstream_id'],
        targetKind: 'upstreams', value: own(upstream, 'upstream_id'),
      });
    });
  });
  return found;
}
