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

import { prepareDependencyExport } from '@/apis/dependency-export';
import { mapImportEnvironment } from '@/apis/environment-import';
import { exportAllResources, type ExportData, exportSelectedResources, IMPORT_ORDER } from '@/apis/export-import';
import { req } from '@/config/req';
import { adminKeyAtom } from '@/stores/global';
import { readExportCoverage } from '@/utils/exportCoverage';
import { parseSharingExport, redactSharingExport } from '@/utils/sharingRedaction';
import { compareConfigurationSnapshots, parseConfigurationSnapshot, snapshotComparisonReport } from '@/utils/snapshotComparison';

test.describe.configure({ mode: 'serial' });
const adapter = req.defaults.adapter; const store = getDefaultStore();
let values: Map<string, { value: Record<string, unknown>; key?: string }[]>;
let details: Map<string, Record<string, unknown>>;
let responses: Map<string, unknown>;
let failures: Map<string, number>;
let reads: string[];
let writes: string[];
const entries = (count: number, owner?: string) => Array.from({ length: count }, (_, index) => ({ value: { id: String(index), ...(owner ? { service_id: owner } : {}), future: { kept: [2, 1] } } }));

test.beforeEach(() => {
  values = new Map(); details = new Map(); responses = new Map(); failures = new Map(); reads = []; writes = [];
  store.set(adminKeyAtom, 'coverage-fixture-only');
  req.defaults.adapter = async (config) => {
    const path = config.url ?? ''; const page = Number(config.params?.page ?? 1); const key = `${path}?page=${page}`;
    if (config.method !== 'get') writes.push(path); reads.push(key);
    const list = values.get(path) ?? [];
    const data = responses.has(key) ? responses.get(key) : path === '/plugins' ? {} : details.has(path) ? { value: details.get(path), key: `/apisix${path}` }
      : { list: list.slice((page - 1) * 100, page * 100), total: list.length };
    const status = failures.get(key) ?? 200;
    const response = { data, status, statusText: status === 200 ? 'OK' : 'Fixture failure', config, headers: new AxiosHeaders() };
    if (status !== 200) throw new AxiosError('Fixture failure', 'ERR_BAD_REQUEST', config, undefined, response);
    return response;
  };
});

test.afterEach(() => { req.defaults.adapter = adapter; store.set(adminKeyAtom, ''); });

const parse = (data: ExportData | unknown) => parseConfigurationSnapshot(JSON.stringify(data), 'fixture.json');

test('full export verifies all pages and records complete top-level and owner scope', async () => {
  values.set('/routes', entries(201));
  values.set('/services', [{ value: { id: 'svc' } }]);
  values.set('/consumers', [{ value: { username: 'alice' } }]);
  values.set('/services/svc/graphql_cost_decorations', entries(101, 'svc'));
  values.set('/consumers/alice/credentials', entries(101));
  const data = await exportAllResources(); const coverage = readExportCoverage(data.coverage, IMPORT_ORDER);
  expect(data.resources.routes).toHaveLength(201); expect(data.resources.credentials).toHaveLength(101); expect(data.resources.graphqlCostDecorations).toHaveLength(101);
  expect(data.skippedResources).toEqual([]); expect(coverage.mode).toBe('full');
  expect(coverage.collections.credentials).toMatchObject({ state: 'complete', count: 101, owners: { requested: ['/consumers/alice'], completed: ['/consumers/alice'], catalogComplete: true } });
  expect(reads).toContain('/routes?page=3'); expect(reads).toContain('/services/svc/graphql_cost_decorations?page=2');
  expect(parse(data).collections.get('routes')?.coverage).toBe('Complete'); expect(writes).toEqual([]);
});

for (const [failure, response, status] of [
  ['changing total', { list: entries(1), total: 102 }, 200],
  ['duplicate', { list: entries(1), total: 101 }, 200],
  ['empty page', { list: [], total: 101 }, 200],
  ['failed page', undefined, 503],
] as const) test(`${failure} prevents any full-export artifact`, async () => {
  values.set('/routes', entries(101)); responses.set('/routes?page=2', response); failures.set('/routes?page=2', status);
  await expect(exportAllResources()).rejects.toThrow('No file was exported'); expect(writes).toEqual([]);
});

test('a failed first page is explicitly incomplete and cannot establish absence, including unread owners', async () => {
  values.set('/routes', [{ value: { id: 'existing' } }]);
  const complete = await exportAllResources();
  failures.set('/routes?page=1', 503); failures.set('/consumers?page=1', 503);
  const partial = await exportAllResources();
  expect(partial.skippedResources).toEqual(expect.arrayContaining(['routes', 'consumers', 'credentials']));
  expect(partial.coverage?.collections.routes).toMatchObject({ state: 'incomplete', count: 0 });
  expect(partial.coverage?.collections.credentials.owners).toMatchObject({ requested: [], completed: [], catalogComplete: false });
  expect(compareConfigurationSnapshots(parse(complete), parse(partial)).counts['Not comparable']).toBe(1);
});

test('child empty 404 requires the exact owner and a mismatched owner or key blocks export', async () => {
  values.set('/services', [{ value: { id: 'svc' } }]); failures.set('/services/svc/graphql_cost_decorations?page=1', 404);
  details.set('/services/svc', { id: 'svc' });
  expect((await exportAllResources()).coverage?.collections.graphqlCostDecorations).toMatchObject({ state: 'complete', count: 0 });
  details.set('/services/svc', { id: 'other-private-owner' });
  await expect(exportAllResources()).rejects.toThrow('No file was exported');
  failures.clear(); values.set('/services/svc/graphql_cost_decorations', [{ value: { id: 'cost', service_id: 'other-private-owner' } }]);
  await expect(exportAllResources()).rejects.toThrow('No file was exported');
  values.set('/services/svc/graphql_cost_decorations', [{ value: { id: 'cost', service_id: 'svc' }, key: '/apisix/services/wrong/graphql_cost_decorations/cost' }]);
  await expect(exportAllResources()).rejects.toThrow('No file was exported');
});

test('metadata catalog and value identities are verified before declaring complete coverage', async () => {
  responses.set('/plugins?page=1', { 'http-logger': { metadata_schema: {} } });
  details.set('/plugin_metadata/http-logger', { log_format: { keep: '$host' } });
  const valid = await exportAllResources(); expect(valid.resources.pluginMetadata).toEqual([{ id: 'http-logger', log_format: { keep: '$host' } }]);
  expect(valid.coverage?.collections.pluginMetadata).toMatchObject({ state: 'complete', scope: { type: 'ids', values: ['/plugin_metadata/http-logger'] } });
  responses.set('/plugins?page=1', {});
  const smallerCatalog = await exportAllResources();
  expect(compareConfigurationSnapshots(parse(valid), parse(smallerCatalog)).counts['Not comparable']).toBe(1);
  responses.set('/plugins?page=1', { 'http-logger': { metadata_schema: {} } });
  responses.set('/plugin_metadata/http-logger?page=1', { value: { log_format: {} }, key: '/apisix/plugin_metadata/wrong' });
  await expect(exportAllResources()).rejects.toThrow('No file was exported');
  responses.set('/plugins?page=1', []); await expect(exportAllResources()).rejects.toThrow('No file was exported');
});

test('selected export records exact IDs and never treats different selections as deletion', async () => {
  details.set('/routes/one', { id: 'one', uri: '/one' }); details.set('/routes/two', { id: 'two', uri: '/two' });
  const one = await exportSelectedResources('/routes', ['one']); const two = await exportSelectedResources('/routes', ['two']);
  expect(snapshotComparisonReport(parse(one), parse(two)).before.coverage).toEqual(one.coverage);
  expect(one.coverage).toMatchObject({ mode: 'selected', selectedResources: ['routes'], rootUrls: ['/routes/one'] });
  expect(one.coverage?.collections.services).toMatchObject({ state: 'excluded', count: 0 });
  expect(compareConfigurationSnapshots(parse(one), parse(two)).counts).toMatchObject({ Added: 0, Removed: 0, 'Not comparable': 2 });
  expect(readExportCoverage(one.coverage, IMPORT_ORDER).collections.routes.scope).toEqual({ type: 'ids', values: ['/routes/one'] });
});

test('dependency scope records roots, supported paths and exact Service owner coverage including empty children', async () => {
  details.set('/routes/one', { id: 'one', service_id: 'svc' }); details.set('/services/svc', { id: 'svc' });
  const bundle = await prepareDependencyExport('/routes', ['one'], { graphqlCostDecorations: true, pluginReferences: true });
  const coverage = readExportCoverage(bundle.data.coverage, IMPORT_ORDER);
  expect(coverage.rootUrls).toEqual(['/routes/one']); expect(coverage.referencePaths).toContain('plugins.grpc-transcode.proto_id');
  expect(coverage.collections.graphqlCostDecorations).toMatchObject({ scope: { type: 'owners', values: ['/services/svc'] }, state: 'complete', count: 0, owners: { completed: ['/services/svc'], catalogComplete: false } });
  expect(parse(bundle.data).collections.get('routes')?.coverage).toBe('Complete');
});

test('matching full scope distinguishes complete emptiness from selected scope and redacted artifacts stay blocked from import', async () => {
  values.set('/routes', [{ value: { id: 'one', plugins: { 'key-auth': { key: 'fake-key' } } } }]);
  const before = await exportAllResources(); values.set('/routes', []); const after = await exportAllResources();
  expect(compareConfigurationSnapshots(parse(before), parse(after)).counts.Removed).toBe(1);
  const redacted = redactSharingExport(parseSharingExport(JSON.stringify(after)), []);
  expect(compareConfigurationSnapshots(parse(before), parse(redacted)).counts['Not comparable']).toBe(1);
  expect(() => mapImportEnvironment(redacted as unknown as ExportData, '{}')).toThrow('sharing');
});

test('contradictory metadata, owner claims, out-of-scope IDs and prototype-like keys cannot claim complete reads', async () => {
  details.set('/routes/__proto__', { id: '__proto__' }); const data = await exportSelectedResources('/routes', ['__proto__']);
  expect(parse(data).collections.get('routes')?.items.has('/routes/__proto__')).toBe(true);
  for (const mutate of [
    (value: Record<string, unknown>) => { value.mode = ['selected']; },
    (value: Record<string, unknown>) => { (value.collections as Record<string, Record<string, unknown>>).routes.state = ['complete']; },
    (value: Record<string, unknown>) => { ((value.collections as Record<string, Record<string, unknown>>).routes.scope as Record<string, unknown>).type = ['ids']; },
  ]) {
    const malformed = JSON.parse(JSON.stringify(data)); mutate(malformed.coverage);
    expect(() => parse(malformed)).toThrow(/coverage/i);
  }
  const invalid = structuredClone(data); invalid.coverage!.collections.routes.count = 0;
  expect(() => parse(invalid)).toThrow('Coverage count');
  invalid.coverage!.collections.routes.count = 1; invalid.coverage!.collections.routes.scope = { type: 'ids', values: ['/routes/other'] };
  expect(() => parse(invalid)).toThrow('outside declared ID scope');
  const full = await exportAllResources(); full.coverage!.collections.credentials.owners = { requested: ['/consumers/alice'], completed: [], catalogComplete: true };
  expect(() => parse(full)).toThrow('Incomplete owner reads'); expect(Object.prototype).not.toHaveProperty('polluted');
});


test('native Secret composite IDs keep the established export identity shape after exact verification', async () => {
  values.set('/secrets', [{ value: { id: 'vault/main', token: 'fake-secret' }, key: '/apisix/secrets/vault/main' }]);
  const data = await exportAllResources(); expect(data.resources.secrets).toEqual([{ id: 'main', manager: 'vault', token: 'fake-secret' }]);
  expect(parse(data).collections.get('secrets')?.items.has('/secrets/vault/main')).toBe(true);
  values.set('/secrets', [{ value: { id: 'vault/main', manager: 'aws' } }]);
  await expect(exportAllResources()).rejects.toThrow('No file was exported');
});
