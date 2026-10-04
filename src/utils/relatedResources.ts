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

export type RelatedReference = { api: string; label: string };
const validId = (value: unknown) => (typeof value === 'string' && value.length > 0 && !['.', '..'].includes(value)) ||
  (typeof value === 'number' && Number.isSafeInteger(value));
export const supportsRelatedResources = (api: string) => /^\/(routes|stream_routes|services)\/[^/]+$/.test(api);
export function referenceFor(kind: string, value: unknown, label: string): RelatedReference | undefined {
  return validId(value) ? { api: `/${kind}/${encodeURIComponent(String(value))}`, label: `${label}: ${String(value)}` } : undefined;
}
export function relatedReferences(api: string, json: string) {
  const references: RelatedReference[] = [];
  const warnings: string[] = [];
  let value: unknown;
  try { value = JSON.parse(json); } catch { return { references, warnings: ['Fix the draft JSON to inspect its references.'] }; }
  if (!isRecord(value)) return { references, warnings: ['The draft must be a JSON object.'] };
  const kind = api.split('/')[1];
  const fields: Array<[string, string, string]> = [
    ...(kind === 'routes' || kind === 'stream_routes' ? [['service_id', 'services', 'Service']] as Array<[string, string, string]> : []),
    ['upstream_id', 'upstreams', 'Upstream'],
    ...(kind === 'routes' ? [['plugin_config_id', 'plugin_configs', 'Plugin Config']] as Array<[string, string, string]> : []),
  ];
  for (const [field, target, label] of fields) {
    if (!Object.hasOwn(value, field) || value[field] == null) continue;
    const reference = referenceFor(target, value[field], label);
    if (reference) references.push(reference);
    else warnings.push(`${field} must contain a valid resource ID.`);
  }
  return { references, warnings };
}
