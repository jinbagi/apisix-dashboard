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
import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

import { environmentMappingRows, mapImportEnvironment, parseIdMappings, updateIdMapping } from '@/apis/environment-import';
import { type ExportData } from '@/apis/export-import';
import { supportedPluginReferences } from '@/utils/pluginReferences';

const makeData = (routes: Record<string, unknown>[]): ExportData => ({
  version: 3, exportedAt: '2026-10-04T00:00:00Z',
  resources: { routes, services: [], upstreams: [], streamRoutes: [], consumers: [], credentials: [],
    consumerGroups: [], ssls: [], globalRules: [], pluginConfigs: [], pluginMetadata: [], protos: [], secrets: [] },
});
async function setup(page: Page, data: ExportData, existing: Record<string, Record<string, unknown>> = {}) {
  const records = new Map(Object.entries(existing));
  const failures = new Map<string, number>();
  const writes: { path: string; body: unknown }[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    if (request.method() === 'PUT') {
      writes.push({ path, body: request.postDataJSON() });
      records.set(path, { ...request.postDataJSON(), ...(/^\/consumers\/[^/]+$/.test(path) ? { username: decodeURIComponent(path.split('/').at(-1)!) } : { id: decodeURIComponent(path.split('/').at(-1)!) }) });
      return route.fulfill({ json: { value: request.postDataJSON() } });
    }
    if (failures.has(path)) return route.fulfill({ status: failures.get(path), json: { error_msg: 'Read unavailable' } });
    if (records.has(path)) return route.fulfill({ json: { value: records.get(path) } });
    if (/^\/(routes|stream_routes|consumers|secrets|services|upstreams|consumer_groups|plugin_configs|protos|global_rules)\/.+/.test(path)) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('export_import');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'preview.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  return { records, failures, writes };
}
const modal = (page: Page) => page.getByRole('dialog', { name: 'Confirm Import', exact: true });
async function preview(page: Page) {
  await page.getByRole('button', { name: 'Import Selected Resources', exact: true }).click();
  await expect(modal(page)).toBeVisible();
}

test('environment mapping preserves unknown fields, numeric references and child ownership', async () => {
  const data = makeData([{ id: 'route', service_id: 'dev-service', upstream_id: 7, plugin_config_id: 'dev-config', future: { keep: true } }]);
  data.resources.services = [{ id: 'dev-service', upstream_id: 7 }];
  data.resources.upstreams = [{ id: 7, nodes: { backend: 1 } }];
  data.resources.consumers = [{ username: 'alice', group_id: 'dev-group' }];
  data.resources.credentials = [{ id: 'main', username: 'alice', plugins: {} }];
  data.resources.graphqlCostDecorations = [{ id: 'cost', service_id: 'dev-service' }];
  const mapped = mapImportEnvironment(data, JSON.stringify({ services: { 'dev-service': 'prod-service' }, upstreams: { '7': 'prod-upstream' },
    pluginConfigs: { 'dev-config': 'prod-config' }, consumers: { alice: 'prod-alice' }, consumerGroups: { 'dev-group': 'prod-group' } }));
  expect(mapped.resources.routes[0]).toEqual({ id: 'route', service_id: 'prod-service', upstream_id: 'prod-upstream', plugin_config_id: 'prod-config', future: { keep: true } });
  expect(mapped.resources.credentials[0].username).toBe('prod-alice');
  expect(mapped.resources.graphqlCostDecorations![0].service_id).toBe('prod-service');
  expect(mapped.resources.consumers[0].group_id).toBe('prod-group');
  expect(data.resources.routes[0].upstream_id).toBe(7);
});

test('environment comparison applies only selected resources', async ({ page }) => {
  const controls = await setup(page, makeData([{ id: 'chosen', uri: '/chosen' }, { id: 'leave', uri: '/leave' }]));
  await page.getByRole('button', { name: 'Compare with current environment' }).click();
  await modal(page).getByRole('checkbox', { name: 'Apply /routes/leave', exact: true }).uncheck();
  await expect(modal(page)).toContainText('1 item(s) selected');
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 1 succeeded, 0 failed')).toBeVisible();
  expect(controls.writes.map((write) => write.path)).toEqual(['/routes/chosen']);
});

test('mapped dependencies are previewed together and required new resources cannot be deselected', async ({ page }) => {
  const data = makeData([{ id: 'route', uri: '/route', service_id: 'dev-service' }]);
  data.resources.services = [{ id: 'dev-service', upstream_id: 'dev-upstream' }];
  data.resources.upstreams = [{ id: 'dev-upstream', nodes: { backend: 1 } }];
  const controls = await setup(page, data);
  await page.getByText('Environment ID mappings (optional)', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Environment ID mappings' }).fill(JSON.stringify({ services: { 'dev-service': 'prod-service' }, upstreams: { 'dev-upstream': 'prod-upstream' } }));
  await preview(page);
  await expect(modal(page)).toContainText('/services/prod-service');
  await modal(page).getByRole('checkbox', { name: 'Apply /upstreams/prod-upstream', exact: true }).uncheck();
  await expect(modal(page)).toContainText('Select required new dependencies');
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await modal(page).getByRole('checkbox', { name: 'Apply /upstreams/prod-upstream', exact: true }).check();
  await page.screenshot({ path: test.info().outputPath('comparison.png'), animations: 'disabled' });
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 3 succeeded, 0 failed')).toBeVisible();
  expect(controls.writes).toEqual([
    { path: '/upstreams/prod-upstream', body: { nodes: { backend: 1 } } },
    { path: '/services/prod-service', body: { upstream_id: 'prod-upstream' } },
    { path: '/routes/route', body: { uri: '/route', service_id: 'prod-service' } },
  ]);
});

test('invalid ID maps and duplicate mapped destinations cannot be applied', async ({ page }) => {
  const controls = await setup(page, makeData([{ id: 'a', uri: '/a' }, { id: 'b', uri: '/b' }]));
  await page.getByText('Environment ID mappings (optional)', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Environment ID mappings' }).fill('{"routes":{"a":"../escape"}}');
  await page.getByRole('button', { name: 'Compare with current environment' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid destination ID in routes' }).first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Environment ID mappings' }).fill('{"routes":{"a":"same","b":"same"}}');
  await page.getByRole('button', { name: 'Compare with current environment' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ID mapping collision' }).first()).toBeVisible();
  await expect(modal(page)).toHaveCount(0);
  expect(controls.writes).toEqual([]);
});

test('mapped destinations are checked again before applying selected changes', async ({ page }) => {
  const controls = await setup(page, makeData([{ id: 'dev', uri: '/new' }]), { '/routes/prod': { id: 'prod', uri: '/before' } });
  await page.getByText('Environment ID mappings (optional)', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Environment ID mappings' }).fill('{"routes":{"dev":"prod"}}');
  await preview(page); controls.records.set('/routes/prod', { id: 'prod', uri: '/concurrent' });
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 0 succeeded, 1 failed')).toBeVisible();
  expect(controls.writes).toEqual([]);
});


test('mapping remaps supported plugin IDs in every owner and preserves unknown properties and the source', () => {
  const data = makeData([]);
  const plugins = { 'grpc-transcode': { proto_id: 7, service: 'Example', method: 'Run', future: { keep: true } },
    'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 'dev-upstream', weight: 3 }, { upstream: { nodes: { backend: 1 } } }, { weight: 1 }] }] },
    custom: { proto_id: 7, upstream_id: 'dev-upstream' } };
  for (const kind of ['routes', 'streamRoutes', 'services', 'pluginConfigs', 'consumers', 'consumerGroups', 'globalRules'] as const)
    data.resources[kind] = [{ id: kind, username: 'alice', plugins: structuredClone(plugins), future: JSON.parse('{"__proto__":{"keep":"own"},"constructor":"retained"}') }];
  data.resources.protos = [{ id: 7, content: 'proto source' }];
  data.resources.upstreams = [{ id: 'dev-upstream', nodes: { backend: 1 } }];
  const original = structuredClone(data);
  const mapped = mapImportEnvironment(data, '{"protos":{"7":"prod-proto"},"upstreams":{"dev-upstream":"prod-upstream"}}');
  for (const kind of ['routes', 'streamRoutes', 'services', 'pluginConfigs', 'consumers', 'consumerGroups', 'globalRules'] as const) {
    expect(mapped.resources[kind][0].plugins).toMatchObject({ 'grpc-transcode': { proto_id: 'prod-proto', future: { keep: true } },
      'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 'prod-upstream', weight: 3 }, { upstream: { nodes: { backend: 1 } } }, { weight: 1 }] }] },
      custom: { proto_id: 7, upstream_id: 'dev-upstream' } });
    expect(Object.hasOwn(mapped.resources[kind][0].future as object, '__proto__')).toBe(true);
  }
  expect(mapped.resources.protos[0].id).toBe('prod-proto');
  expect(data).toEqual(original);
  expect(mapImportEnvironment(data, '{}')).toEqual(data);
  const invalid = makeData([{ id: 'bad', plugins: { 'grpc-transcode': { proto_id: [7] } } }]);
  expect(mapImportEnvironment(invalid, '{"protos":{"7":"prod-proto"}}').resources.routes[0].plugins).toEqual({ 'grpc-transcode': { proto_id: [7] } });
});

test('mapping own-property names do not pollute prototypes or drop explicit reference-only mappings', () => {
  const data = makeData([{ id: '__proto__', uri: '/safe' }]);
  const text = updateIdMapping('{}', 'routes', '__proto__', 'constructor');
  expect(Object.hasOwn(parseIdMappings(text).routes!, '__proto__')).toBe(true);
  expect(mapImportEnvironment(data, text).resources.routes[0].id).toBe('constructor');
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(() => parseIdMappings('{"__proto__":{"polluted":"yes"}}')).toThrow('Unsupported ID mapping');
  expect(() => parseIdMappings('{"routes":{"a":"same","b":"same"}}')).toThrow('ID mapping collision');
  expect(() => mapImportEnvironment(makeData([{ id: 'a' }, { id: 'b' }]), '{"routes":{"a":"b"}}')).toThrow('ID mapping collision');
  expect(environmentMappingRows(data, '{"protos":{"external":"destination"}}')).toContainEqual(expect.objectContaining({ kind: 'protos', source: 'external', destination: 'destination' }));
  expect(JSON.parse(updateIdMapping(text, 'routes', '__proto__', ''))).toEqual({});
});

test('shared plugin extractor uses explicit owner scopes and own properties only', () => {
  const plugins = { 'grpc-transcode': { proto_id: 'proto' }, 'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 7 }, { upstream: {} }, { weight: 1 }] }] }, custom: { upstream_id: 'unknown' } };
  expect(supportedPluginReferences('routes', { plugins }).map((ref) => [ref.field, ref.value])).toEqual([
    ['plugins.grpc-transcode.proto_id', 'proto'], ['plugins.traffic-split.rules[0].weighted_upstreams[0].upstream_id', 7],
  ]);
  expect(supportedPluginReferences('upstreams', { plugins })).toEqual([]);
  expect(supportedPluginReferences('routes', Object.create({ plugins }))).toEqual([]);
  expect(supportedPluginReferences('routes', { plugins: Object.create(plugins) })).toEqual([]);
});

test('visual ID mapping remaps Proto and plugin references with original and destination previews', async ({ page }) => {
  const data = makeData([{ id: 'route', uri: '/route', plugins: { 'grpc-transcode': { proto_id: 'dev-proto', service: 'Example', method: 'Run' },
    'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 'dev-upstream' }] }] }, custom: { untouched: true } } }]);
  data.resources.protos = [{ id: 'dev-proto', content: 'syntax = "proto3";' }];
  data.resources.upstreams = [{ id: 'dev-upstream', nodes: { backend: 1 } }];
  const controls = await setup(page, data);
  await page.getByText('Environment ID mappings (optional)', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Destination protos/dev-proto', exact: true }).fill('prod-proto');
  await page.getByRole('textbox', { name: 'Destination upstreams/dev-upstream', exact: true }).fill('prod-upstream');
  await page.getByRole('textbox', { name: 'Destination routes/route', exact: true }).fill('prod-route');
  await expect(page.getByRole('textbox', { name: 'Environment ID mappings' })).toHaveValue(/prod-proto/);
  await page.screenshot({ path: test.info().outputPath('environment-id-mapping.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  const narrowDestination = page.getByRole('textbox', { name: 'Destination protos/dev-proto', exact: true });
  await narrowDestination.scrollIntoViewIfNeeded();
  const narrowBounds = await narrowDestination.boundingBox();
  expect(narrowBounds!.x + narrowBounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('environment-id-mapping-narrow.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await preview(page);
  await expect(modal(page)).toContainText('/routes/route');
  await expect(modal(page)).toContainText('/routes/prod-route');
  const row = modal(page).getByRole('row').filter({ hasText: '/routes/prod-route' });
  await row.getByRole('button', { name: 'Review mapping' }).click();
  const diff = page.getByRole('dialog', { name: 'Import mapping comparison' });
  await expect(diff).toContainText('exported payload on the left; mapped payload on the right');
  await diff.getByRole('button', { name: 'Back to import preview' }).click();
  await modal(page).getByRole('checkbox', { name: 'Apply /protos/prod-proto', exact: true }).uncheck();
  await expect(modal(page)).toContainText('Select required new dependencies');
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await modal(page).getByRole('checkbox', { name: 'Apply /protos/prod-proto', exact: true }).check();
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 3 succeeded, 0 failed')).toBeVisible();
  expect(controls.writes.map((write) => write.path)).toEqual(['/protos/prod-proto', '/upstreams/prod-upstream', '/routes/prod-route']);
  expect(controls.writes[2].body).toMatchObject({ plugins: { 'grpc-transcode': { proto_id: 'prod-proto' }, 'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 'prod-upstream' }] }] }, custom: { untouched: true } } });
});

test('mapping collisions remain editable in the visual table and keyboard editing can reset an ID', async ({ page }) => {
  const controls = await setup(page, makeData([{ id: 'a', uri: '/a' }, { id: 'b', uri: '/b' }]));
  await page.getByText('Environment ID mappings (optional)', { exact: true }).click();
  const destination = page.getByRole('textbox', { name: 'Destination routes/a', exact: true });
  await destination.fill('b');
  await expect(page.getByRole('alert').filter({ hasText: 'ID mapping collision' })).toBeVisible();
  await destination.press('ControlOrMeta+A'); await destination.press('Backspace');
  await expect(page.getByRole('alert').filter({ hasText: 'ID mapping collision' })).toHaveCount(0);
  await destination.pressSequentially('new-a');
  await expect(page.getByRole('textbox', { name: 'Environment ID mappings' })).toHaveValue(/new-a/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export mapping JSON' }).click();
  expect(JSON.parse(await readFile((await (await download).path())!, 'utf8'))).toEqual({ routes: { a: 'new-a' } });
  await page.getByRole('button', { name: 'Reset mappings' }).click();
  await expect(destination).toHaveValue('');
  const upload = page.locator('.ant-upload-wrapper').filter({ has: page.getByRole('button', { name: 'Import mapping JSON' }) }).locator('input[type="file"]');
  await upload.setInputFiles({ name: 'mapping.json', mimeType: 'application/json', buffer: Buffer.from('{"routes":{"a":"loaded"}}') });
  await expect(destination).toHaveValue('loaded');
  expect(controls.writes).toEqual([]);
});

test('external plugin references must exist and remain readable before applying', async ({ page }) => {
  const data = makeData([{ id: 'route', uri: '/route', plugins: { 'grpc-transcode': { proto_id: 'outside' } } }]);
  const controls = await setup(page, data);
  await preview(page);
  await expect(modal(page)).toContainText('Unresolved reference at plugins.grpc-transcode.proto_id');
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await modal(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  controls.records.set('/protos/outside', { id: 'outside', content: 'proto' });
  await preview(page);
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  controls.failures.set('/protos/outside', 503);
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 0 succeeded, 1 failed')).toBeVisible();
  expect(controls.writes).toEqual([]);
});


test('mapped Consumer credentials and GraphQL child owners keep their parent dependencies', async ({ page }) => {
  const data = makeData([]);
  data.resources.services = [{ id: 'dev-service', name: 'GraphQL service' }];
  data.resources.graphqlCostDecorations = [{ id: 'cost', service_id: 'dev-service', field_path: 'Query.users', add_value: 1 }];
  data.resources.consumers = [{ username: 'alice', desc: 'Example' }];
  data.resources.credentials = [{ id: 'main', username: 'alice', plugins: { 'key-auth': { key: 'fixture-only-key' } } }];
  const controls = await setup(page, data);
  await page.getByText('Environment ID mappings (optional)', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Destination services/dev-service', exact: true }).fill('prod-service');
  await page.getByRole('textbox', { name: 'Destination consumers/alice', exact: true }).fill('prod-alice');
  await preview(page);
  await expect(modal(page)).toContainText('/services/prod-service/graphql_cost_decorations/cost');
  await expect(modal(page)).toContainText('/consumers/prod-alice/credentials/main');
  await modal(page).getByRole('checkbox', { name: 'Apply /consumers/prod-alice', exact: true }).uncheck();
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await modal(page).getByRole('checkbox', { name: 'Apply /consumers/prod-alice', exact: true }).check();
  await modal(page).getByRole('checkbox', { name: 'Apply /services/prod-service', exact: true }).uncheck();
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await modal(page).getByRole('checkbox', { name: 'Apply /services/prod-service', exact: true }).check();
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 4 succeeded, 0 failed')).toBeVisible();
  expect(controls.writes.map((write) => write.path)).toEqual(['/services/prod-service', '/services/prod-service/graphql_cost_decorations/cost', '/consumers/prod-alice', '/consumers/prod-alice/credentials/main']);
  expect(controls.writes[1].body).toEqual({ field_path: 'Query.users', add_value: 1 });
  expect(controls.writes[3].body).toEqual({ plugins: { 'key-auth': { key: 'fixture-only-key' } } });
});


test('external reference array IDs and conflicting envelope keys block preview and write preflight', async ({ page }) => {
  const data = makeData([{ id: 'route', uri: '/route', plugins: { 'grpc-transcode': { proto_id: 'outside' } } }]);
  const controls = await setup(page, data);
  let external: { value: unknown; key?: string } = { value: { id: ['outside'], content: 'private-other-proto' } };
  await page.route('**/apisix/admin/protos/outside', (route) => route.fulfill({ json: external }));
  await preview(page);
  await expect(modal(page)).toContainText('Unresolved reference at plugins.grpc-transcode.proto_id');
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await expect(modal(page)).not.toContainText('private-other-proto');
  await modal(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  external = { value: { id: 'outside' }, key: '/apisix/protos/other' };
  await preview(page);
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await modal(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  external = { value: { id: 'outside' }, key: '/custom-etcd-prefix/protos/outside' };
  await preview(page);
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  external = { value: { id: ['outside'] } };
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 0 succeeded, 1 failed')).toBeVisible();
  expect(controls.writes).toEqual([]);
});
