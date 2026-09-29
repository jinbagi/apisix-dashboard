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
import type { ZodTypeAny } from 'zod';

import { RoutePostSchema, RoutePutSchema } from '@/components/form-slice/FormPartRoute/schema';
import { produceRoute } from '@/components/form-slice/FormPartRoute/util';
import { SSLPostSchema, SSLPutSchema } from '@/components/form-slice/FormPartSSL/schema';
import { FormPartUpstreamSchema, UpstreamPostSchema } from '@/components/form-slice/FormPartUpstream/schema';
import { getAdminResourceSchema } from '@/utils/resourceJsonSchema';

const identity = { id: 'parity', create_time: 1, update_time: 1 };
const issues = (schema: ZodTypeAny, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map(({ path, message }: { path: unknown[]; message: string }) => ({ path, message }));
};

for (const [label, payload] of Object.entries({
  'missing URI': {},
  'conflicting URIs': { uri: '/a', uris: ['/b'] },
  'conflicting hosts': { uri: '/', host: 'a.test', hosts: ['b.test'] },
  'conflicting addresses': { uri: '/', remote_addr: '127.0.0.1', remote_addrs: ['127.0.0.2'] },
  'invalid vars type': { uri: '/', vars: 'not an array' },
  'missing inline backend': { uri: '/', upstream: { type: 'roundrobin' } },
  'missing rewrite host': { uri: '/', upstream: { nodes: { 'localhost:80': 1 }, pass_host: 'rewrite' } },
})) {
  test(`Route form and JSON report identical errors: ${label}`, () => {
    const input = { ...identity, ...payload };
    const expected = issues(getAdminResourceSchema('/routes/parity')!, input);
    expect(expected.length).toBeGreaterThan(0);
    expect(issues(RoutePostSchema, input)).toEqual(expected);
    expect(issues(RoutePutSchema, input)).toEqual(expected);
  });
}

for (const payload of [{}, { service_name: 'svc' }, { discovery_type: 'dns' }, { nodes: { 'localhost:80': 1 }, pass_host: 'rewrite' }]) {
  test(`Upstream form and JSON report identical errors: ${JSON.stringify(payload)}`, () => {
    const input = { ...identity, ...payload };
    const expected = issues(getAdminResourceSchema('/upstreams/parity')!, input);
    expect(expected.length).toBeGreaterThan(0);
    expect(issues(UpstreamPostSchema, input)).toEqual(expected);
    expect(issues(FormPartUpstreamSchema, input)).toEqual(expected);
  });
}

test('route payload preserves nested expressions, plugin values and unknown fields', () => {
  const payload = {
    uri: '/',
    vars: [['OR', ['arg_x', '==', ''], ['arg_y', '!', '==', null]], ['arg_n', 'in', [1, 2]]],
    plugins: { custom: { empty: '', nullable: null } },
    future_field: { nested: '' },
    service_id: 'svc',
    upstream_id: 'override',
  };
  expect(RoutePostSchema.safeParse(payload).success).toBe(true);
  expect(produceRoute({ ...payload, __checksEnabled: false })).toEqual(payload);
});

for (const payload of [{}, { cert: 'cert' }, { key: 'key' }, { cert: 'cert', key: 'key', client: {} }]) {
  test(`SSL form and JSON report identical errors: ${JSON.stringify(payload)}`, () => {
    const input = { ...identity, ...payload };
    const expected = issues(getAdminResourceSchema('/ssls/parity')!, input);
    expect(expected.length).toBeGreaterThan(0);
    expect(issues(SSLPostSchema, input)).toEqual(expected);
    expect(issues(SSLPutSchema, input)).toEqual(expected);
  });
}

test('cleans empty inline controls without cleaning opaque upstream configuration', () => {
  const result = produceRoute({
    uri: '/',
    upstream: {
      name: '', desc: '', service_name: '', discovery_type: '', upstream_host: '',
      nodes: { 'localhost:80': 1 },
      tls: { verify: false, client_cert: '', client_key: '', client_cert_id: '' },
      checks: { active: { host: '', http_path: '', healthy: {}, unhealthy: {} } },
      discovery_args: { empty: '', nested: { empty: '' } },
    },
  });
  expect(result.upstream).not.toHaveProperty('name');
  expect(result.upstream).not.toHaveProperty('service_name');
  expect(result.upstream?.tls).toEqual({ verify: false });
  expect(result.upstream?.checks?.active).not.toHaveProperty('host');
  expect(result.upstream?.discovery_args).toEqual({ empty: '', nested: { empty: '' } });
});
