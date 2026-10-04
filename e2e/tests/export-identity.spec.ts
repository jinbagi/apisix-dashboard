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
import { AxiosHeaders } from 'axios';
import { getDefaultStore } from 'jotai';

import { prepareDependencyExport } from '@/apis/dependency-export';
import { exportSelectedResources } from '@/apis/export-import';
import { req } from '@/config/req';
import { adminKeyAtom } from '@/stores/global';

test.describe.configure({ mode: 'serial' });
const originalAdapter = req.defaults.adapter;
const store = getDefaultStore();
let responses: Map<string, { value: unknown; key?: unknown }>;
let reads: { api: string; timeout?: number }[];

test.beforeEach(() => {
  responses = new Map(); reads = []; store.set(adminKeyAtom, 'fixture-only-key');
  req.defaults.adapter = async (config) => {
    reads.push({ api: config.url ?? '', timeout: config.timeout });
    return { data: responses.get(config.url ?? ''), status: 200, statusText: 'OK', config, headers: new AxiosHeaders() };
  };
});

test.afterEach(() => { req.defaults.adapter = originalAdapter; store.set(adminKeyAtom, ''); });

test('selected exports validate numeric, encoded and composite identities before adding export metadata', async () => {
  const route = JSON.parse('{"id":7,"future":{"__proto__":{"preserved":true}},"uri":"/seven"}');
  responses.set('/routes/7', { value: route, key: '/custom-prefix/routes/7' });
  responses.set('/routes/encoded%20id%3F', { value: { id: 'encoded id?', uri: '/encoded' }, key: '/apisix/routes/encoded id?' });
  const selected = await exportSelectedResources('/routes', ['7', '7', 'encoded id?']);
  expect(selected.resources.routes).toHaveLength(2);
  expect(selected.resources.routes[0]).toMatchObject({ id: '7', uri: '/seven' });
  expect(JSON.stringify(selected.resources.routes[0])).toContain('"__proto__":{"preserved":true}');
  expect(route.id).toBe(7); expect(reads).toHaveLength(2); expect(reads.every((read) => read.timeout === 15_000)).toBe(true);
  responses.set('/secrets/vault/main', { value: { id: 'vault/main', token: 'fake-token' }, key: '/apisix/secrets/vault/main' });
  const secrets = await exportSelectedResources('/secrets', ['vault/main']);
  expect(secrets.resources.secrets[0]).toMatchObject({ id: 'main', manager: 'vault', token: 'fake-token' });
});

test('Plugin Metadata requires its matching envelope key and may omit value.id', async () => {
  responses.set('/plugin_metadata/http-logger', { value: { log_format: { host: '$host' } }, key: '/apisix/plugin_metadata/http-logger' });
  const selected = await exportSelectedResources('/plugin_metadata', ['http-logger']);
  expect(selected.resources.pluginMetadata[0]).toEqual({ id: 'http-logger', log_format: { host: '$host' } });
  responses.set('/plugin_metadata/http-logger', { value: { id: 'http-logger' } });
  await expect(exportSelectedResources('/plugin_metadata', ['http-logger'])).rejects.toThrow('No file was exported');
});

test('selected export rejects missing or malformed identities and an inconsistent response key', async () => {
  for (const response of [
    { value: {} }, { value: { id: ['first'] } }, { value: { id: 'other' } },
    { value: { id: 'first' }, key: '/apisix/routes/other' },
    { value: { id: 'first' }, key: null },
  ]) {
    responses.set('/routes/first', response);
    await expect(exportSelectedResources('/routes', ['first'])).rejects.toThrow('No file was exported');
  }
  responses.set('/consumers/alice', { value: { id: 'alice' } });
  await expect(exportSelectedResources('/consumers', ['alice'])).rejects.toThrow('No file was exported');
});

test('dependency export refuses string-coercible fake IDs and never follows their references', async () => {
  responses.set('/routes/first', { value: { id: ['first'], service_id: 'private-reference' } });
  const result = await prepareDependencyExport('/routes', ['first']);
  expect(result.blocked).toBe(1); expect(result.rows[0].status).toBe('Unreadable');
  expect(result.data.resources.routes).toEqual([]);
  expect(reads.map((read) => read.api)).toEqual(['/routes/first']);
});
