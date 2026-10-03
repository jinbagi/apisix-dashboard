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
    if (id) {
      reads.push(path);
      const value = data[resource]?.find((item) => String(item.id) === id);
      if (!value) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
      return route.fulfill({ json: { value: { ...value, desc: 'Fresh API value', future_field: { retained: true } } } });
    }
    return route.fulfill({ json: { list: (data[resource] ?? []).map((value) => ({ value })), total: (data[resource] ?? []).length } });
  });
  await page.goto(kind);
  return { data, failures, reads, writes };
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

