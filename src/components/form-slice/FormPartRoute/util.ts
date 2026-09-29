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
import { produce } from 'immer';

import type { RoutePostType, RoutePutType } from './schema';

// Both editors use the Admin API array representation, including nested expressions.
export const produceVarsToForm = (data: RoutePostType) => data as RoutePutType;

export const produceVarsToAPI = produce((draft: RoutePostType) => {
  const payload = draft as Record<string, unknown>;
  for (const field of ['uri', 'host', 'remote_addr', 'service_id', 'upstream_id', 'plugin_config_id', 'filter_func', 'script', 'script_id', 'name', 'desc']) {
    if (typeof payload[field] === 'string' && !payload[field].trim()) delete payload[field];
  }
  for (const field of ['uris', 'hosts', 'remote_addrs', 'methods', 'vars']) {
    if (Array.isArray(payload[field]) && payload[field].length === 0) delete payload[field];
  }
  // Inline Upstream controls also register empty optional strings. Clean only
  // these known input paths, never arbitrary nested plugin/discovery data.
  const upstream = draft.upstream;
  if (upstream) {
    for (const field of ['name', 'desc', 'service_name', 'discovery_type', 'key', 'upstream_host'] as const) {
      if (typeof upstream[field] === 'string' && !upstream[field].trim()) delete upstream[field];
    }
    if (upstream.tls) {
      for (const field of ['client_cert', 'client_key', 'client_cert_id'] as const) {
        if (upstream.tls[field] === '') delete upstream.tls[field];
      }
    }
    if (upstream.checks?.active) {
      for (const field of ['host', 'http_path'] as const) {
        if (upstream.checks.active[field] === '') delete upstream.checks.active[field];
      }
    }
  }
  // Only top-level UI flags belong to this form. Never recursively clean plugin
  // configs or vars: empty strings, nulls and nested expressions can be meaningful.
  for (const field of Object.keys(payload)) {
    if (field.startsWith('__')) delete payload[field];
  }
});

export const produceRoute = produceVarsToAPI;
