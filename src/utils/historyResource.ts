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

// Only exact resource endpoints are eligible. Console subpaths and queries remain executable.
const collections = new Set(['routes', 'stream_routes', 'services', 'upstreams', 'consumers', 'consumer_groups', 'ssls', 'global_rules', 'plugin_configs', 'plugin_metadata', 'protos']);
const generatedCollections = new Set(['routes', 'stream_routes', 'services', 'upstreams', 'ssls', 'protos']);
export function getHistoryTarget(api: string): { detail: boolean; generated: boolean } | undefined {
  if (!api.startsWith('/') || /[?#]/.test(api)) return;
  const parts = api.slice(1).split('/');
  try {
    if (parts.some((part) => !part || /[/\\]/.test(decodeURIComponent(part)) || ['.', '..'].includes(decodeURIComponent(part)))) return;
  } catch { return; }
  if (parts.length === 1 && generatedCollections.has(parts[0])) return { detail: false, generated: true };
  if (parts.length === 2 && collections.has(parts[0])) return { detail: true, generated: false };
  if (parts.length === 3 && parts[0] === 'secrets') return { detail: true, generated: false };
  if (parts[0] === 'consumers' && parts[2] === 'credentials' && parts.length === 4) return { detail: true, generated: false };
  if (parts[0] === 'services' && parts[2] === 'graphql_cost_decorations') {
    if (parts.length === 3) return { detail: false, generated: true };
    if (parts.length === 4) return { detail: true, generated: false };
  }
}

export const getHistoryIgnoredPaths = (api: string) => api.startsWith('/ssls/') ? ['key', 'keys']
  : api.startsWith('/secrets/') ? ['token', 'secret_access_key', 'session_token', 'auth_config.private_key']
    : api.startsWith('/upstreams/') ? ['tls.client_key']
      : /^\/(routes|services|stream_routes)\//.test(api) ? ['upstream.tls.client_key'] : [];
export const hasHistoryProtectedFields = (api: string, ...values: unknown[]) =>
  getHistoryIgnoredPaths(api).some((path) => values.some((value) =>
    path.split('.').reduce<unknown>((current, key) => isRecord(current) && Object.hasOwn(current, key) ? current[key] : undefined, value) !== undefined));
