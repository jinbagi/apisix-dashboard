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

import type { ExportData } from '@/apis/export-import';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export with dependencies', exact: true });
async function setup(page: Page, kind = 'routes') {
  const data: Record<string, Record<string, unknown>[]> = {
    routes: [
      { id: 'first', uri: '/first', service_id: 'shared', plugin_config_id: 'common', upstream_id: 'direct' },
      { id: 'second', uri: '/second', service_id: 'shared', plugin_config_id: 'common' },
      { id: 'not-selected', uri: '/unused', service_id: 'unrelated' },
    ],
    stream_routes: [{ id: 'stream', server_port: 9100, service_id: 'shared', upstream_id: 'direct' }],
    services: [{ id: 'shared', upstream_id: 'backend' }, { id: 'unrelated', upstream_id: 'unused' }],
    upstreams: [{ id: 'backend', nodes: { '127.0.0.1:1980': 1 } }, { id: 'direct', nodes: { '127.0.0.1:1981': 1 } }],
    plugin_configs: [{ id: 'common', plugins: { 'proxy-rewrite': { uri: '/test' } } }],
  };
  const failures = new Map<string, number>();
  const collections: Record<string, { list: { value: Record<string, unknown>; key?: string }[]; total: number }> = {};
  const reads: string[] = [];
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname.replace('/apisix/admin/', ''));
    if (request.method() !== 'GET') writes.push(path);
    const [resource, ...identity] = path.split('/');
    const id = identity.join('/');
    if (failures.has(path)) return route.fulfill({ status: failures.get(path), json: { error_msg: 'Unavailable fixture' } });
    if (collections[path]) { reads.push(path); return route.fulfill({ json: collections[path] }); }
    if (id) {
      reads.push(path);
      const value = data[resource]?.find((item) => String(item.id) === id);
      if (!value) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
      return route.fulfill({ json: { value: { ...value, desc: 'Fresh API value', future_field: { retained: true } } } });
    }
    return route.fulfill({ json: { list: (data[resource] ?? []).map((value) => ({ value })), total: (data[resource] ?? []).length } });
  });
  await page.goto(kind);
  return { data, failures, reads, writes, collections };
}
async function open(page: Page, selected = 1) {
  const checkboxes = page.getByRole('checkbox', { name: 'Select row', exact: true });
  for (let index = 0; index < selected; index++) await checkboxes.nth(index).check();
  await page.getByRole('region', { name: 'Selected resource actions' }).getByRole('button', { name: 'Export with dependencies', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: 'Refresh export preview' })).toBeEnabled();
}
async function download(page: Page): Promise<ExportData> {
  const event = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Download bundle' }).click();
  const file = await event;
  const buffer = await readFile((await file.path())!);
  return JSON.parse(buffer.toString()) as ExportData;
}

test('bundles selected Routes and transitive dependencies once, retaining every reason and import compatibility', async ({ page }) => {
  const { reads, writes } = await setup(page);
  await open(page, 2);
  await expect(dialog(page).getByRole('status')).toHaveText('6 included · 0 unresolved references');
  await expect(dialog(page)).toContainText('routes/first → service_id; routes/second → service_id');
  await expect(dialog(page)).toContainText('services/shared → upstream_id');
  await page.screenshot({ path: test.info().outputPath('dependency-export.png'), animations: 'disabled' });
  const exported = await download(page);
  expect(exported.version).toBe(3);
  expect(exported.resources.routes.map((item) => item.id)).toEqual(['first', 'second']);
  expect(exported.resources.services.map((item) => item.id)).toEqual(['shared']);
  expect(exported.resources.upstreams.map((item) => item.id).sort()).toEqual(['backend', 'direct']);
  expect(exported.resources.pluginConfigs.map((item) => item.id)).toEqual(['common']);
  expect(exported.resources.routes[0]).toMatchObject({ desc: 'Fresh API value', future_field: { retained: true } });
  expect(reads.filter((path) => path === 'services/shared')).toHaveLength(1);
  expect(reads.filter((path) => path === 'upstreams/backend')).toHaveLength(1);
  expect(reads).not.toContain('services/unrelated');
  expect(exported.skippedResources?.[0]).toContain('Plugin-internal references');
  expect(JSON.stringify(exported)).not.toContain('test-admin-key');
  await dialog(page).getByRole('button', { name: 'Close export' }).click();
  await page.goto('export_import');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'bundle.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByLabel('Routes (2)', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Services (1)', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Upstreams (2)', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Plugin Configs (1)', { exact: true })).toBeChecked();
  expect(writes).toEqual([]);
});

test('Stream Routes include direct and Service upstreams', async ({ page }) => {
  const { writes } = await setup(page, 'stream_routes');
  await open(page);
  await expect(dialog(page).getByRole('status')).toHaveText('4 included · 0 unresolved references');
  const exported = await download(page);
  expect(exported.resources.streamRoutes.map((item) => item.id)).toEqual(['stream']);
  expect(exported.resources.upstreams.map((item) => item.id).sort()).toEqual(['backend', 'direct']);
  expect(exported.resources.routes).toEqual([]);
  expect(writes).toEqual([]);
});

test('a single Service exports its upstream even when no Route is selected', async ({ page }) => {
  const { writes } = await setup(page, 'services');
  await open(page);
  await expect(dialog(page).getByRole('status')).toHaveText('2 included · 0 unresolved references');
  const exported = await download(page);
  expect(exported.resources.services.map((item) => item.id)).toEqual(['shared']);
  expect(exported.resources.upstreams.map((item) => item.id)).toEqual(['backend']);
  expect(exported.resources.routes).toEqual([]);
  expect(writes).toEqual([]);
});

for (const status of [404, 503]) {
  test(`reference read failure ${status} blocks downloads until a fresh preview resolves it`, async ({ page }) => {
    const { failures, writes } = await setup(page);
    failures.set('upstreams/backend', status);
    await open(page);
    await expect(dialog(page)).toContainText('Download blocked');
    await expect(dialog(page).getByRole('status')).toHaveText('4 included · 1 unresolved references');
    await expect(dialog(page).getByRole('button', { name: 'Download bundle' })).toBeDisabled();
    failures.clear();
    await dialog(page).getByRole('button', { name: 'Refresh export preview' }).click();
    await expect(dialog(page).getByRole('status')).toHaveText('5 included · 0 unresolved references');
    await expect(dialog(page).getByRole('button', { name: 'Download bundle' })).toBeEnabled();
    expect(writes).toEqual([]);
  });
}

test('missing selected resources and invalid reference identities cannot produce a partial bundle', async ({ page }) => {
  const { data, failures, writes, reads } = await setup(page);
  data.routes[0].upstream_id = '..';
  failures.set('routes/second', 404);
  await open(page, 2);
  await expect(dialog(page).getByRole('status')).toHaveText('4 included · 2 unresolved references');
  await expect(dialog(page)).toContainText('Invalid resource reference; no request was sent.');
  await expect(dialog(page).getByRole('button', { name: 'Download bundle' })).toBeDisabled();
  expect(reads).not.toContain('upstreams/..');
  expect(writes).toEqual([]);
});

test('numeric reference IDs and encoded IDs are normalized without losing opaque fields', async ({ page }) => {
  const { data, reads } = await setup(page);
  data.routes[0].service_id = 42;
  data.routes[0].upstream_id = 'direct?blue';
  data.services[0].id = 42;
  data.upstreams[1].id = 'direct?blue';
  await open(page);
  await expect(dialog(page).getByRole('status')).toHaveText('5 included · 0 unresolved references');
  const exported = await download(page);
  expect(exported.resources.services[0].id).toBe('42');
  expect(reads).toContain('upstreams/direct?blue');
  expect(exported.resources.upstreams.find((item) => item.id === 'direct?blue')).toMatchObject({ future_field: { retained: true } });
});

test('narrow export preview stays within the viewport and preserves the table selection on close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await open(page);
  await expect(dialog(page).getByRole('status')).toHaveText('5 included · 0 unresolved references');
  const bounds = await dialog(page).boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await dialog(page).getByRole('button', { name: 'Close export' }).click();
  await expect(page.getByRole('region', { name: 'Selected resource actions' })).toContainText('Selected 1 item(s)');
});



test('opt-in includes GraphQL owners, shared Protos and traffic-split upstreams once', async ({ page }) => {
  const { data, reads, writes, collections } = await setup(page, 'services');
  const plugins = { 'grpc-transcode': { proto_id: 'shared-proto', service: 'Hello', method: 'Say' },
    'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 'split', weight: 1 }, { upstream: { nodes: { '127.0.0.1:1980': 1 } } }] }] } };
  data.services = [{ id: 'shared', plugins }, { id: 'unrelated', plugins }];
  data.protos = [{ id: 'shared-proto', content: 'syntax = "proto3"; message Hello {}' }];
  data.upstreams.push({ id: 'split', nodes: { '127.0.0.1:1980': 1 } });
  for (const id of ['shared', 'unrelated']) collections[`services/${id}/graphql_cost_decorations`] = {
    list: [{ value: { id: 'same-id', field_path: 'Query.products', add_value: 2, unknown_extension: true } }], total: 1,
  };
  await page.reload();
  await open(page, 2);
  const basic = await download(page);
  expect(basic.resources.protos).toEqual([]);
  expect(basic.resources.graphqlCostDecorations).toEqual([]);
  expect(reads.some((path) => path.includes('graphql_cost_decorations'))).toBe(false);
  await dialog(page).getByLabel('Include Service GraphQL cost decorations', { exact: true }).check();
  await expect(dialog(page).getByRole('button', { name: 'Refresh export preview' })).toBeEnabled();
  await dialog(page).getByLabel('Include supported plugin references', { exact: false }).check();
  await expect(dialog(page).getByRole('status')).toHaveText('6 included · 0 unresolved references');
  await page.screenshot({ path: test.info().outputPath('extended-dependency-export.png'), animations: 'disabled' });
  const exported = await download(page);
  expect(exported.resources.graphqlCostDecorations).toEqual(['shared', 'unrelated'].map((service_id) => ({
    id: 'same-id', service_id, field_path: 'Query.products', add_value: 2, unknown_extension: true,
  })));
  expect(exported.resources.protos.map((item) => item.id)).toEqual(['shared-proto']);
  expect(exported.resources.upstreams.map((item) => item.id)).toEqual(['split']);
  expect(reads.filter((path) => path === 'protos/shared-proto')).toHaveLength(1);
  expect(reads.filter((path) => path === 'upstreams/split')).toHaveLength(1);
  expect(writes).toEqual([]);
});

test('unreadable GraphQL collection and missing plugin dependency block the bundle', async ({ page }) => {
  const { data, failures, writes } = await setup(page, 'services');
  data.services[0].plugins = { 'grpc-transcode': { proto_id: 'missing' } };
  failures.set('services/shared/graphql_cost_decorations', 503);
  await open(page);
  await dialog(page).getByLabel('Include Service GraphQL cost decorations', { exact: true }).check();
  await expect(dialog(page).getByRole('button', { name: 'Refresh export preview' })).toBeEnabled();
  await dialog(page).getByLabel('Include supported plugin references', { exact: false }).check();
  await expect(dialog(page).getByRole('status')).toHaveText('2 included · 2 unresolved references');
  await expect(dialog(page)).toContainText('protos/missing');
  await expect(dialog(page)).toContainText('services/shared/graphql_cost_decorations');
  await expect(dialog(page).getByRole('button', { name: 'Download bundle' })).toBeDisabled();
  failures.clear();
  data.protos = [{ id: 'missing', content: 'syntax = "proto3";' }];
  await dialog(page).getByRole('button', { name: 'Refresh export preview' }).click();
  await expect(dialog(page).getByRole('status')).toHaveText('3 included · 0 unresolved references');
  expect((await download(page)).resources.graphqlCostDecorations).toEqual([]);
  expect(writes).toEqual([]);
});

test('GraphQL pagination includes every child and rejects changing totals or duplicate identities', async ({ page }) => {
  const { writes } = await setup(page, 'services');
  let mode = 'complete';
  await page.route('**/apisix/admin/services/shared/graphql_cost_decorations?*', async (route) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page'));
    const index = mode === 'duplicate' ? 1 : pageNumber;
    await route.fulfill({ json: { total: mode === 'changing' && pageNumber === 2 ? 3 : 2,
      list: [{ value: { id: `child-${index}`, field_path: `Query.field${index}`, add_value: index } }] } });
  });
  await open(page);
  await dialog(page).getByLabel('Include Service GraphQL cost decorations', { exact: true }).check();
  await expect(dialog(page).getByRole('status')).toHaveText('4 included · 0 unresolved references');
  expect((await download(page)).resources.graphqlCostDecorations?.map((item) => item.id)).toEqual(['child-1', 'child-2']);
  mode = 'duplicate';
  await dialog(page).getByRole('button', { name: 'Refresh export preview' }).click();
  await expect(dialog(page)).toContainText('duplicate or mismatched identity');
  await expect(dialog(page).getByRole('button', { name: 'Download bundle' })).toBeDisabled();
  mode = 'changing';
  await dialog(page).getByRole('button', { name: 'Refresh export preview' }).click();
  await expect(dialog(page)).toContainText('invalid or changing total');
  await expect(dialog(page).getByRole('button', { name: 'Download bundle' })).toBeDisabled();
  expect(writes).toEqual([]);
});


test('dependency envelope identity mismatch blocks download and does not traverse the wrong response', async ({ page }) => {
  const { reads, writes } = await setup(page);
  await page.route('**/apisix/admin/services/shared', (route) => route.fulfill({ json: { key: '/apisix/services/other', value: { id: 'shared', upstream_id: 'wrong-private-upstream' } } }));
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await open(page);
  await expect(dialog(page)).toContainText('Admin API resource identity could not be verified for /services/shared');
  await expect(dialog(page).getByRole('button', { name: 'Download bundle' })).toBeDisabled();
  expect(reads).not.toContain('upstreams/wrong-private-upstream');
  expect(downloads).toEqual([]); expect(writes).toEqual([]);
});

test('GraphQL child envelope key and empty-collection owner detail must match the requested Service', async ({ page }) => {
  const { collections, failures, writes } = await setup(page, 'services');
  const childPath = 'services/shared/graphql_cost_decorations';
  collections[childPath] = { list: [{ value: { id: 'cost', field_path: 'Query.viewer' }, key: '/apisix/services/other/graphql_cost_decorations/cost' }], total: 1 };
  await open(page);
  await dialog(page).getByRole('checkbox', { name: 'Include Service GraphQL cost decorations' }).check();
  await expect(dialog(page)).toContainText('Admin API resource identity could not be verified');
  await expect(dialog(page).getByRole('button', { name: 'Download bundle' })).toBeDisabled();
  delete collections[childPath]; failures.set(childPath, 404);
  let ownerReads = 0;
  await page.route('**/apisix/admin/services/shared', (route) => {
    ownerReads++;
    return route.fulfill({ json: { value: { id: 'shared' }, key: ownerReads === 1 ? '/apisix/services/shared' : '/apisix/services/other' } });
  });
  await dialog(page).getByRole('button', { name: 'Refresh export preview' }).click();
  await expect(dialog(page)).toContainText('Admin API resource identity could not be verified for /services/shared');
  await expect(dialog(page).getByRole('button', { name: 'Download bundle' })).toBeDisabled();
  expect(ownerReads).toBe(2); expect(writes).toEqual([]);
});
