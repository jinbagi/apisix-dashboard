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
import { isRecord } from './apisixEditable';

// Clean only known optional form controls. Plugin, discovery and future fields
// are opaque JSON: empty strings, nulls and __-prefixed keys can be meaningful.
const omitEmptyStrings = (data: Record<string, unknown>, fields: string[]) => {
  for (const field of fields) {
    if (typeof data[field] === 'string' && !data[field].trim()) delete data[field];
  }
};

const cleanUpstream = (data: Record<string, unknown>) => {
  omitEmptyStrings(data, ['name', 'desc', 'service_name', 'discovery_type', 'key', 'upstream_host']);
  if (isRecord(data.tls)) omitEmptyStrings(data.tls, ['client_cert', 'client_key', 'client_cert_id']);
  if (isRecord(data.checks) && isRecord(data.checks.active)) {
    omitEmptyStrings(data.checks.active, ['host', 'http_path']);
  }
};

export const prepareResourceFormPayload = <T extends Record<string, unknown>>(data: T): T => {
  // Use transport semantics for cleared (undefined) fields without walking and
  // rewriting arbitrary configuration objects.
  const payload: T = JSON.parse(JSON.stringify(data));
  for (const field of Object.keys(payload)) {
    if (field.startsWith('__')) delete payload[field];
  }
  delete payload.create_time;
  delete payload.update_time;
  omitEmptyStrings(payload, ['name', 'desc', 'service_id', 'upstream_id', 'group_id', 'script', 'server_addr', 'remote_addr', 'sni']);
  if (isRecord(payload.upstream)) cleanUpstream(payload.upstream);
  return payload;
};

export const prepareUpstreamFormPayload = <T extends Record<string, unknown>>(data: T): T => {
  const payload = prepareResourceFormPayload(data);
  cleanUpstream(payload);
  return payload;
};
