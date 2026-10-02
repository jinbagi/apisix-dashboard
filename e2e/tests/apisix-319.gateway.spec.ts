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
import { genTLS, randomId } from '@e2e/utils/common';
import { getE2eReq } from '@e2e/utils/req';
import { type APIResponse, expect, test as base } from '@playwright/test';
import type { AxiosInstance } from 'axios';

import { graphqlCostDecorationsApi } from '@/apis/graphql_cost_decorations';
import { API_HEADER_KEY } from '@/config/constant';

type Gateway = {
  admin: AxiosInstance;
  own: (path: string) => string;
  send: (method: string, path: string, data?: unknown) => Promise<APIResponse>;
};

// This suite checks real Admin API contracts, without claiming backend traffic,
// TLS handshake, WebSocket relay or MCP tool execution coverage.
const test = base.extend<{ gateway: Gateway }>({
  gateway: async ({ request }, use) => {
    const admin = await getE2eReq(request);
    const owned = new Set<string>();
    const send: Gateway['send'] = (method, path, data) => request.fetch(
      `${admin.defaults.baseURL}${path}`,
      {
        method,
        data,
        failOnStatusCode: false,
        headers: { [API_HEADER_KEY]: String(admin.defaults.headers[API_HEADER_KEY]) },
      }
    );
    try {
      await use({ admin, send, own: (path) => { owned.add(path); return path; } });
    } finally {
      // Child decorations are registered after their Service, so remove them first.
      for (const path of [...owned].reverse()) {
        const response = await send('DELETE', path);
        expect([200, 404], `Clean up only this test's resource: ${path}`).toContain(response.status());
      }
    }
  },
});

const nodes = { '127.0.0.1:1980': 1 };
const warmUp = {
  slow_start_time_seconds: 30,
  min_weight_percent: 10,
  interval: 2,
  aggression: 0.5,
  startup_grace_period_seconds: 0,
};

for (const scheme of ['ws', 'wss']) {
  test(`APISIX 3.19 persists native ${scheme} upstreams`, async ({ gateway }) => {
    const path = gateway.own(`/upstreams/${randomId(`gateway319-${scheme}`)}`);
    const payload = { nodes, type: 'roundrobin', scheme };
    await gateway.admin.put(path, payload);
    expect((await gateway.admin.get(path)).data.value).toMatchObject(payload);
    await gateway.admin.put(path, { ...payload, desc: 'Updated native WebSocket upstream' });
    expect((await gateway.admin.get(path)).data.value).toMatchObject({ ...payload, desc: 'Updated native WebSocket upstream' });
  });
}

test('APISIX 3.19 persists and removes roundrobin slow-start settings', async ({ gateway }) => {
  const path = gateway.own(`/upstreams/${randomId('gateway319-warmup')}`);
  await gateway.admin.put(path, { nodes, type: 'roundrobin', warm_up_conf: warmUp });
  expect((await gateway.admin.get(path)).data.value.warm_up_conf).toMatchObject(warmUp);
  const invalid = await gateway.send('PUT', path, {
    nodes, type: 'roundrobin', warm_up_conf: { ...warmUp, interval: 31 },
  });
  expect(invalid.status(), await invalid.text()).toBe(400);
  expect((await gateway.admin.get(path)).data.value.warm_up_conf).toMatchObject(warmUp);
  await gateway.admin.put(path, { nodes, type: 'roundrobin' });
  expect((await gateway.admin.get(path)).data.value).not.toHaveProperty('warm_up_conf');
});

test('APISIX 3.19 round-trips real CA certificates and rejects CA settings on wss', async ({ gateway }) => {
  const path = gateway.own(`/upstreams/${randomId('gateway319-ca')}`);
  const { cert } = await genTLS();
  const payload = { nodes, type: 'roundrobin', scheme: 'https', tls: { ca_certs: [cert], verify: true } };
  await gateway.admin.put(path, payload);
  expect((await gateway.admin.get(path)).data.value).toMatchObject(payload);
  const invalid = await gateway.send('PUT', path, { ...payload, scheme: 'wss' });
  expect(invalid.status(), await invalid.text()).toBe(400);
  expect((await gateway.admin.get(path)).data.value).toMatchObject(payload);
  await gateway.admin.put(path, { nodes, type: 'roundrobin', scheme: 'https', tls: { verify: false } });
  const updated = (await gateway.admin.get(path)).data.value;
  expect(updated.tls.verify).toBe(false);
  expect(updated.tls).not.toHaveProperty('ca_certs');
});

test('APISIX 3.19 persists plural SNIs and route TLS passthrough including explicit false', async ({ gateway }) => {
  const path = gateway.own(`/stream_routes/${randomId('gateway319-stream')}`);
  const upstream = { nodes, type: 'roundrobin', scheme: 'tcp' };
  const payload = { snis: ['api.example.com', '*.example.com'], tls_passthrough: true, upstream };
  await gateway.admin.put(path, payload);
  expect((await gateway.admin.get(path)).data.value).toMatchObject(payload);
  await gateway.admin.put(path, { ...payload, tls_passthrough: false });
  expect((await gateway.admin.get(path)).data.value).toMatchObject({ snis: payload.snis, tls_passthrough: false });
  await gateway.admin.put(path, { sni: 'single.example.com', upstream });
  const replaced = (await gateway.admin.get(path)).data.value;
  expect(replaced.sni).toBe('single.example.com');
  expect(replaced).not.toHaveProperty('snis');
  // APISIX may materialize its default; omission must never retain the old true.
  expect(replaced.tls_passthrough ?? false).toBe(false);
});

test('APISIX 3.19 rejects conflicting and duplicate stream SNIs without changing saved data', async ({ gateway }) => {
  const path = gateway.own(`/stream_routes/${randomId('gateway319-sni')}`);
  const payload = { snis: ['api.example.com'], upstream: { nodes, type: 'roundrobin', scheme: 'tcp' } };
  await gateway.admin.put(path, payload);
  const conflicting = await gateway.send('PUT', path, { ...payload, sni: 'single.example.com' });
  expect(conflicting.status(), await conflicting.text()).toBe(400);
  const duplicate = await gateway.send('PUT', path, { ...payload, snis: ['api.example.com', 'api.example.com'] });
  expect(duplicate.status(), await duplicate.text()).toBe(400);
  expect((await gateway.admin.get(path)).data.value).toMatchObject(payload);
});

test('APISIX 3.19 supports service-scoped GraphQL decoration CRUD and rejects duplicate field paths', async ({ gateway }) => {
  const serviceId = randomId('gateway319-graphql');
  const servicePath = gateway.own(`/services/${serviceId}`);
  await gateway.admin.put(servicePath, { upstream: { nodes, type: 'roundrobin' } });
  const collection = graphqlCostDecorationsApi(serviceId);
  const path = gateway.own(`${collection}/${randomId('decoration')}`);
  const payload = { field_path: 'Query.products', add_value: 2, add_arguments: ['limit'], mul_value: 1, mul_arguments: ['first'] };
  await gateway.admin.put(path, payload);
  expect((await gateway.admin.get(path)).data.value).toMatchObject(payload);
  const list = (await gateway.admin.get(collection)).data;
  expect(list.total).toBe(1);
  expect(list.list).toEqual([expect.objectContaining({ value: expect.objectContaining(payload) })]);
  const duplicatePath = gateway.own(`${collection}/${randomId('duplicate')}`);
  const duplicate = await gateway.send('PUT', duplicatePath, payload);
  expect(duplicate.status(), await duplicate.text()).toBe(400);
  await gateway.admin.put(path, { ...payload, add_value: 3, mul_value: 2 });
  expect((await gateway.admin.get(path)).data.value).toMatchObject({ ...payload, add_value: 3, mul_value: 2 });
  expect((await gateway.admin.get(collection)).data.total).toBe(1);
  const deleted = await gateway.send('DELETE', path);
  expect(deleted.status()).toBe(200);
  const missing = await gateway.send('GET', path);
  expect(missing.status()).toBe(404);
});

for (const plugin of [
  {
    name: 'websocket-proxy',
    properties: ['client_max_payload_len', 'upstream_max_payload_len'],
    config: { client_max_payload_len: 65536, upstream_max_payload_len: 131072 },
    invalid: { client_max_payload_len: 0 },
    scheme: 'ws',
  },
  {
    name: 'openapi-to-mcp',
    properties: ['openapi_url', 'base_url', 'transport', 'flatten_parameters'],
    config: {
      openapi_url: 'http://127.0.0.1:1980/openapi.json',
      base_url: 'http://127.0.0.1:1980',
      transport: 'streamable_http',
      flatten_parameters: false,
    },
    invalid: { openapi_url: 'http://127.0.0.1:1980/openapi.json' },
    scheme: 'http',
  },
]) {
  test(`APISIX 3.19 exposes and accepts ${plugin.name} configuration`, async ({ gateway }) => {
    const enabled = (await gateway.admin.get('/plugins/list')).data as string[];
    // eslint-disable-next-line playwright/no-skipped-test -- Availability depends on the target gateway configuration.
    test.skip(!enabled.includes(plugin.name), `${plugin.name} is not enabled on this APISIX instance`);
    const schema = (await gateway.admin.get(`/plugins/${plugin.name}`)).data;
    expect(schema.type).toBe('object');
    for (const field of plugin.properties) expect(schema.properties).toHaveProperty(field);
    const path = gateway.own(`/routes/${randomId(`gateway319-${plugin.name}`)}`);
    const payload = {
      uri: `/${randomId('gateway319')}`,
      upstream: { nodes, type: 'roundrobin', scheme: plugin.scheme },
      plugins: { [plugin.name]: plugin.config },
    };
    await gateway.admin.put(path, payload);
    expect((await gateway.admin.get(path)).data.value.plugins[plugin.name]).toMatchObject(plugin.config);
    const invalid = await gateway.send('PUT', path, { ...payload, plugins: { [plugin.name]: plugin.invalid } });
    expect(invalid.status(), await invalid.text()).toBe(400);
    expect((await gateway.admin.get(path)).data.value.plugins[plugin.name]).toMatchObject(plugin.config);
  });
}
