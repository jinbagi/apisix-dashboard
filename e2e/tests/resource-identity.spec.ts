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
import { expect, test } from '@playwright/test';

import { validateExactResourceSnapshot } from '@/utils/resourceIdentity';

test('exact identity validation accepts every supported top-level collection without modifying snapshots', () => {
  for (const collection of ['routes', 'stream_routes', 'services', 'upstreams', 'consumer_groups', 'ssls', 'global_rules', 'plugin_configs', 'protos']) {
    const value = { id: 7, future: { opaque: true } };
    const before = structuredClone(value);
    expect(() => validateExactResourceSnapshot(`/${collection}/7`, value, `/custom-prefix/${collection}/7`)).not.toThrow();
    expect(value).toEqual(before);
    expect(() => validateExactResourceSnapshot(`/${collection}/other`, value)).toThrow(/identity could not be verified/);
  }
  expect(() => validateExactResourceSnapshot('/consumers/alice', { username: 'alice', id: 'irrelevant' })).not.toThrow();
  expect(() => validateExactResourceSnapshot('/routes/a%3Fb', { id: 'a?b' }, '/apisix/routes/a?b')).not.toThrow();
});

test('missing, inherited and malformed primary identities never pass through string coercion', () => {
  for (const value of [null, [], {}, { id: null }, { id: ['7'] }, { id: { toString: () => '7' } }, { id: Infinity }, Object.create({ id: '7' })]) {
    expect(() => validateExactResourceSnapshot('/routes/7', value)).toThrow(/identity could not be verified/);
  }
  expect(() => validateExactResourceSnapshot('/consumers/alice', { id: 'alice' })).toThrow();
  for (const api of ['/routes', '/routes/', '/unknown/7', '/routes/7/extra', '/routes/%', '/routes/7?x=1', 'routes/7']) {
    expect(() => validateExactResourceSnapshot(api, { id: '7' })).toThrow();
  }
});

test('child ownership and Secret manager are checked independently of short and composite IDs', () => {
  for (const value of [{ id: 'main' }, { id: 'alice/credentials/main' }, { id: 'main', username: 'alice' }]) {
    const before = structuredClone(value);
    expect(() => validateExactResourceSnapshot('/consumers/alice/credentials/main', value)).not.toThrow();
    expect(value).toEqual(before);
  }
  for (const value of [{ id: 'other/credentials/main' }, { id: 'main', username: 'other' }, { id: 'main', username: null }]) {
    expect(() => validateExactResourceSnapshot('/consumers/alice/credentials/main', value)).toThrow();
  }
  for (const value of [{ id: 'main' }, { id: 'vault/main' }, { id: 'main', manager: 'vault' }]) {
    expect(() => validateExactResourceSnapshot('/secrets/vault/main', value)).not.toThrow();
  }
  for (const value of [{ id: 'aws/main' }, { id: 'main', manager: 'aws' }]) {
    expect(() => validateExactResourceSnapshot('/secrets/vault/main', value)).toThrow();
  }
  expect(() => validateExactResourceSnapshot('/services/7/graphql_cost_decorations/cost', { id: 'cost', service_id: 7 })).not.toThrow();
  expect(() => validateExactResourceSnapshot('/services/7/graphql_cost_decorations/cost', { id: 'cost', service_id: ['7'] })).toThrow();
  expect(() => validateExactResourceSnapshot('/services/7/graphql_cost_decorations/cost', { id: 'cost' }, '/apisix/services/8/graphql_cost_decorations/cost')).toThrow();
});

test('Plugin Metadata uses its exact envelope key and rejects conflicting optional IDs', () => {
  const value = { log_format: { host: '$host' } };
  expect(() => validateExactResourceSnapshot('/plugin_metadata/http-logger', value, '/custom/plugin_metadata/http-logger')).not.toThrow();
  expect(value).not.toHaveProperty('id');
  for (const key of [undefined, null, '/apisix/plugin_metadata/other']) {
    expect(() => validateExactResourceSnapshot('/plugin_metadata/http-logger', value, key)).toThrow();
  }
  for (const id of ['other', null, ['http-logger']]) {
    expect(() => validateExactResourceSnapshot('/plugin_metadata/http-logger', { ...value, id }, '/apisix/plugin_metadata/http-logger')).toThrow();
  }
});

test('supplied response keys must match and errors reveal only the requested destination', () => {
  for (const key of [null, 7, '/apisix/routes/other', 'routes/expected']) {
    expect(() => validateExactResourceSnapshot('/routes/expected', { id: 'expected' }, key)).toThrow();
  }
  expect(() => validateExactResourceSnapshot('/consumers/alice', { username: 'private-other-user', secret: 'must-not-leak' }))
    .toThrow('Admin API resource identity could not be verified for /consumers/alice');
});
