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
import { AxiosError, AxiosHeaders } from 'axios';
import { getDefaultStore } from 'jotai';

import { mapDependencyClone, prepareCloneDrafts, previewDependencyClone, suggestCloneMappings } from '@/apis/dependency-clone';
import { prepareDependencyExport } from '@/apis/dependency-export';
import { type ExportData, IMPORT_ORDER } from '@/apis/export-import';
import { req } from '@/config/req';
import { adminKeyAtom } from '@/stores/global';

test.describe.configure({ mode: 'serial' });
const originalAdapter = req.defaults.adapter;
const store = getDefaultStore();
let records: Map<string, { value: unknown; key?: unknown }>;
let reads: string[];
let writes: string[];
const snapshot = (resources: Partial<ExportData['resources']>): ExportData => ({
  version: 3, exportedAt: '2026-10-04T00:00:00.000Z', resources: { ...Object.fromEntries(IMPORT_ORDER.map((kind) => [kind, []])), ...resources } as ExportData['resources'],
});

test.beforeEach(() => {
  records = new Map(); reads = []; writes = []; store.set(adminKeyAtom, 'fixture-only-key');
  req.defaults.adapter = async (config) => {
    if (config.method !== 'get') writes.push(config.url ?? ''); else reads.push(config.url ?? '');
    const data = records.get(config.url ?? '');
    const response = { data, status: data ? 200 : 404, statusText: data ? 'OK' : 'Not found', config, headers: new AxiosHeaders() };
    if (!data) throw new AxiosError('Not found', 'ERR_BAD_REQUEST', config, undefined, response);
    return response;
  };
});

test.afterEach(() => { req.defaults.adapter = originalAdapter; store.set(adminKeyAtom, ''); });

test('clone remaps standard, supported plugin and child owner references without mutating unknown JSON', async () => {
  const source = snapshot({
    routes: [JSON.parse('{"id":"main","uri":"/same","service_id":"svc","plugin_config_id":"pc","status":1,"future":{"__proto__":{"kept":true},"order":[2,1]}}')],
    services: [{ id: 'svc', upstream_id: 'backend' }], upstreams: [{ id: 'backend', nodes: {} }],
    pluginConfigs: [{ id: 'pc', plugins: { 'grpc-transcode': { proto_id: 'proto' }, 'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 'backend' }] }] }, unknown: { proto_id: 'external' } } }],
    protos: [{ id: 'proto', content: 'test' }], graphqlCostDecorations: [{ id: 'cost', service_id: 'svc', path: 'Query.x', cost: 2 }],
  });
  const before = JSON.stringify(source);
  const { drafts, preview } = await prepareCloneDrafts(source, suggestCloneMappings(source));
  expect(drafts).toHaveLength(6); expect(drafts.every((draft) => draft.baseline === null)).toBe(true);
  expect(preview.rows.every((row) => row.status === 'New')).toBe(true);
  expect(preview.data.resources.routes[0]).toMatchObject({ id: 'main-copy', service_id: 'svc-copy', plugin_config_id: 'pc-copy', status: 0 });
  expect(preview.data.resources.graphqlCostDecorations![0]).toMatchObject({ id: 'cost', service_id: 'svc-copy' });
  expect(preview.rows.find((row) => row.resourceType === 'graphqlCostDecorations')?.url).toBe('/services/svc-copy/graphql_cost_decorations/cost');
  expect(preview.data.resources.pluginConfigs[0]).toMatchObject({ plugins: { 'grpc-transcode': { proto_id: 'proto-copy' }, 'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 'backend-copy' }] }] }, unknown: { proto_id: 'external' } } });
  expect(JSON.stringify(preview.data.resources.routes[0])).toContain('"__proto__":{"kept":true}');
  expect(preview.data.resources.routes[0].future).toMatchObject({ order: [2, 1] });
  expect(JSON.stringify(source)).toBe(before); expect(writes).toEqual([]);
  expect(reads).not.toContain('/protos/external');
});

test('empty mappings and even identical existing destinations block the entire staging batch', async () => {
  const source = snapshot({ routes: [{ id: 'main', uri: '/a' }], upstreams: [{ id: 'backend', nodes: {} }] });
  const unchanged = await prepareCloneDrafts(source, '{}');
  expect(unchanged.drafts).toEqual([]);
  expect(unchanged.preview.rows.every((row) => row.error?.includes('new destination ID'))).toBe(true);
  records.set('/routes/main-copy', { value: { id: 'main-copy', uri: '/a', status: 0 } });
  const existing = await prepareCloneDrafts(source, suggestCloneMappings(source));
  expect(existing.drafts).toEqual([]);
  expect(existing.preview.rows.find((row) => row.resourceType === 'routes')?.error).toContain('already exists');
  expect(writes).toEqual([]);
});

test('a destination appearing between preview and staging is blocked without any write', async () => {
  const source = snapshot({ routes: [{ id: 'main', uri: '/a' }] });
  const mappings = suggestCloneMappings(source);
  expect((await previewDependencyClone(source, mappings)).rows[0].status).toBe('New');
  records.set('/routes/main-copy', { value: { id: 'main-copy', uri: '/someone-else' } });
  expect((await prepareCloneDrafts(source, mappings)).drafts).toEqual([]);
  expect(writes).toEqual([]);
});

test('wrong identity and external reference read failures cannot count as available destinations', async () => {
  const source = snapshot({ routes: [{ id: 'main', service_id: 'external' }] });
  const mappings = suggestCloneMappings(source);
  records.set('/services/external', { value: { id: ['external'] } });
  expect((await prepareCloneDrafts(source, mappings)).drafts).toEqual([]);
  records.set('/services/external', { value: { id: 'external' }, key: '/apisix/services/wrong' });
  expect((await prepareCloneDrafts(source, mappings)).drafts).toEqual([]);
  records.set('/services/external', { value: { id: 'external' }, key: '/apisix/services/external' });
  expect((await prepareCloneDrafts(source, mappings)).drafts).toHaveLength(1);
  records.set('/routes/main-copy', { value: { id: 'wrong' } });
  expect((await prepareCloneDrafts(source, mappings)).drafts).toEqual([]);
});

test('HTTP status is explicit while Stream Route matching and status fields remain unchanged', () => {
  const source = snapshot({ routes: [{ id: 'http', uri: '/a' }], streamRoutes: [{ id: 'stream', server_port: 9100, sni: 'test.example', future: 1 }] });
  const mappings = suggestCloneMappings(source);
  expect(mapDependencyClone(source, mappings).resources.routes[0].status).toBe(0);
  expect(mapDependencyClone(source, mappings, true).resources.routes[0].status).toBe(1);
  expect(mapDependencyClone(source, mappings, true).resources.streamRoutes[0]).toEqual({ id: 'stream-copy', server_port: 9100, sni: 'test.example', future: 1 });
});

test('suggestions preserve own malicious-looking keys, reserve existing IDs and remain valid after sanitization', () => {
  const source = snapshot({ routes: [{ id: '__proto__' }, { id: 'x' }, { id: 'x-copy' }, { id: 'a?b' }, { id: 'a/b' }, { id: 'z'.repeat(64) }] });
  const text = suggestCloneMappings(source);
  expect(Object.hasOwn(JSON.parse(text).routes, '__proto__')).toBe(true);
  const mapped = mapDependencyClone(source, text);
  const ids = mapped.resources.routes.map((item) => item.id as string);
  expect(new Set(ids).size).toBe(6); expect(ids.every((id) => id.length <= 64 && /^[a-zA-Z0-9_.-]+$/.test(id))).toBe(true);
  expect(ids).not.toContain('x-copy');
  expect(Object.prototype).not.toHaveProperty('polluted');
});

test('mapping collisions, duplicate sources and unsupported scope reject before destination reads', async () => {
  const source = snapshot({ routes: [{ id: 'one' }, { id: 'two' }] });
  await expect(previewDependencyClone(source, '{"routes":{"one":"same","two":"same"}}')).rejects.toThrow('collision');
  await expect(previewDependencyClone(snapshot({ routes: [{ id: 'one' }, { id: 'one' }] }), '{}')).rejects.toThrow('Duplicate source');
  await expect(previewDependencyClone(snapshot({ consumers: [{ username: 'alice' }] }), '{}')).rejects.toThrow('not supported');
  expect(reads).toEqual([]);
});

test('dependency source verification blocks wrong IDs before following private references', async () => {
  records.set('/routes/main', { value: { id: 'other', service_id: 'not-requested' } });
  const source = await prepareDependencyExport('/routes', ['main'], { pluginReferences: true, graphqlCostDecorations: true });
  expect(source.blocked).toBe(1); expect(reads).toEqual(['/routes/main']); expect(writes).toEqual([]);
});
