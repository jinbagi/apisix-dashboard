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

const identityText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value :
    typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
const collections = new Set(['routes', 'stream_routes', 'services', 'upstreams', 'consumers',
  'consumer_groups', 'ssls', 'global_rules', 'plugin_configs', 'plugin_metadata', 'protos']);

/** Validate a detail response for an exact relative Admin API path without inventing snapshot data. */
export function validateExactResourceSnapshot(api: string, value: unknown, key?: unknown): asserts value is Record<string, unknown> {
  const mismatch = (): never => { throw new Error(`Admin API resource identity could not be verified for ${api}`); };
  let segments: string[];
  try { segments = api.split('/').slice(1).map(decodeURIComponent); }
  catch { return mismatch(); }
  if (!api.startsWith('/') || api.includes('?') || api.includes('#') || !isRecord(value) || segments.some((segment) => !segment)) return mismatch();
  const [collection, owner, child] = segments;
  const credential = collection === 'consumers' && child === 'credentials' && segments.length === 4;
  const decoration = collection === 'services' && child === 'graphql_cost_decorations' && segments.length === 4;
  const secret = collection === 'secrets' && segments.length === 3;
  const top = collections.has(collection) && segments.length === 2;
  if (!top && !credential && !decoration && !secret) return mismatch();
  const id = segments.at(-1)!;
  const metadata = collection === 'plugin_metadata';
  const primary = top && collection === 'consumers' ? 'username' : 'id';
  const returnedId = Object.hasOwn(value, primary) ? identityText(value[primary]) : undefined;
  const matchingKey = typeof key === 'string' && key.startsWith('/') && key.endsWith(`/${segments.join('/')}`);
  // Plugin Metadata may omit value.id: the envelope key is its canonical identity.
  if (metadata) {
    if (!matchingKey || (Object.hasOwn(value, 'id') && returnedId !== id)) mismatch();
  } else {
    if (returnedId === undefined) return mismatch();
    if (credential) {
      if (returnedId !== id && returnedId !== `${owner}/credentials/${id}`) mismatch();
    } else if (secret) {
      if (returnedId !== id && returnedId !== `${owner}/${id}`) mismatch();
    } else if (returnedId !== id) mismatch();
  }
  const ownerField = credential ? 'username' : decoration ? 'service_id' : secret ? 'manager' : undefined;
  if (ownerField && Object.hasOwn(value, ownerField) && identityText(value[ownerField]) !== owner) mismatch();
  // APISIX keys include the configurable etcd prefix and unescaped path segments.
  if (key !== undefined && !matchingKey) mismatch();
}
