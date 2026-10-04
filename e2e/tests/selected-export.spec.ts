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

import { type ExportData, RESOURCE_LABELS, type ResourceKey } from '@/apis/export-import';

const cases: [string, ResourceKey][] = [
  ['routes', 'routes'], ['stream_routes', 'streamRoutes'], ['services', 'services'],
  ['upstreams', 'upstreams'], ['consumers', 'consumers'], ['consumer_groups', 'consumerGroups'],
  ['ssls', 'ssls'], ['secrets', 'secrets'], ['global_rules', 'globalRules'],
  ['plugin_configs', 'pluginConfigs'], ['protos', 'protos'],
];

async function mockApi(page: Page, resource: string, failSecond = false) {
  const writes: string[] = [];
  const records = ['first', 'second'].map((id) => ({
    id: resource === 'secrets' ? `vault/${id}` : id,
    username: id, name: id, desc: 'List snapshot', uri: `/${id}`,
    upstream: { nodes: { '127.0.0.1:1980': 1 } }, nodes: { '127.0.0.1:1980': 1 },
    plugins: {}, snis: ['example.test'], labels: {}, status: 1,
    server_addr: '127.0.0.1', server_port: 9000, content: 'syntax = "proto3";',
    type: 'roundrobin', scheme: 'http', create_time: 1, update_time: 2,
  }));
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname.replace('/apisix/admin', ''));
    if (request.method() !== 'GET') writes.push(path);
    if (path === `/${resource}`) return route.fulfill({ json: { list: records.map((value) => ({ value })), total: 2 } });
    if (path.startsWith(`/${resource}/`)) {
      const id = path.slice(resource.length + 2);
      if (failSecond && id === 'second') return route.fulfill({ status: 404, json: { error_msg: 'Deleted elsewhere' } });
      return route.fulfill({ json: { value: { ...records.find((record) => record.id === id), desc: 'Fresh API value', future_field: { preserved: true } } } });
    }
    if (path === '/plugins') return route.fulfill({ json: {} });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  return writes;
}

for (const [resource, key] of cases) {
  const expectedIdentity = key === 'consumers' ? { username: 'first' }
    : key === 'secrets' ? { manager: 'vault', id: 'first' } : { id: 'first' };

  test(`${resource}: exports only the selection with fresh values and importable identities`, async ({ page }, testInfo) => {
    const writes = await mockApi(page, resource);
    await page.goto(resource);
    await page.getByRole('checkbox', { name: 'Select row', exact: true }).first().check();
    const actions = page.getByRole('region', { name: 'Selected resource actions' });
    await expect(actions.getByRole('button', { name: 'Export selected' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('selected-export.png'), animations: 'disabled' });
    const downloadEvent = page.waitForEvent('download');
    await actions.getByRole('button', { name: 'Export selected' }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/^apisix-.*-selected-\d{4}-\d{2}-\d{2}\.json$/);
    const buffer = await readFile((await download.path())!);
    const exported = JSON.parse(buffer.toString()) as ExportData;
    expect(exported.version).toBe(3);
    expect(exported.resources[key]).toHaveLength(1);
    expect(exported.resources[key][0]).toMatchObject({ desc: 'Fresh API value', future_field: { preserved: true } });
    expect(exported.resources[key][0]).toMatchObject(expectedIdentity);
    expect(Object.entries(exported.resources).filter(([name]) => name !== key).every(([, items]) => items.length === 0)).toBe(true);
    expect(buffer.toString()).not.toContain('test-admin-key');
    await expect(actions).toContainText('Selected 1 item(s)');
    await page.goto('export_import');
    await page.locator('input[type="file"]').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer });
    await expect(page.getByLabel(`${RESOURCE_LABELS[key]} (1)`, { exact: true })).toBeChecked();
    expect(writes).toEqual([]);
  });
}

test('selection export refuses a partial download and preserves the selection on read failure', async ({ page }) => {
  const writes = await mockApi(page, 'routes', true);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.goto('routes');
  await page.getByRole('checkbox', { name: 'Select all', exact: true }).check();
  await page.getByRole('button', { name: 'Export selected' }).click();
  await expect(page.getByText('Could not read second. No file was exported. Retry after refreshing the list.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export selected' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Selected resource actions' })).toContainText('Selected 2 item(s)');
  expect(downloads).toEqual([]);
  expect(writes).toEqual([]);
});

test('selection export remains reachable on narrow screens and clears with the selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, 'routes');
  await page.goto('routes');
  await page.getByRole('checkbox', { name: 'Select row', exact: true }).first().check();
  const exportButton = page.getByRole('button', { name: 'Export selected' });
  await expect(exportButton).toBeInViewport();
  const bounds = await exportButton.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(exportButton).toBeHidden();
});


for (const [resource, badValue, badKey] of [
  ['routes', { id: 'other', uri: '/wrong', desc: 'wrong-resource-private-content' }, undefined],
  ['routes', { id: 'first' }, '/apisix/routes/other'],
  ['consumers', { username: 'other' }, undefined],
  ['secrets', { id: 'first', manager: 'aws' }, undefined],
] as const) {
  const path = resource === 'secrets' ? 'vault/first' : 'first';

  test(`${resource}: wrong detail identity or key never produces a selected download (${badKey ?? 'value'})`, async ({ page }) => {
    const writes = await mockApi(page, resource);
    await page.route(`**/apisix/admin/${resource}/${path}`, (route) => route.fulfill({ json: { value: badValue, key: badKey } }));
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    await page.goto(resource);
    await page.getByRole('checkbox', { name: 'Select row', exact: true }).first().check();
    await page.getByRole('button', { name: 'Export selected' }).click();
    await expect(page.getByText(`Could not read ${path}. No file was exported. Retry after refreshing the list.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export selected' })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Selected resource actions' })).toContainText('Selected 1 item(s)');
    await expect(page.locator('body')).not.toContainText('wrong-resource-private-content');
    expect(downloads).toEqual([]); expect(writes).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('selected-export-identity-blocked.png'), animations: 'disabled' });
  });
}
