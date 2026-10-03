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
import { expect, type Page, test } from '@playwright/test';

import { type ExportData, getImportRequest } from '@/apis/export-import';

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
      records.set(path, request.postDataJSON());
      return route.fulfill({ json: { value: request.postDataJSON() } });
    }
    if (failures.has(path)) return route.fulfill({ status: failures.get(path), json: { error_msg: 'Read unavailable' } });
    if (records.has(path)) return route.fulfill({ json: { value: records.get(path) } });
    if (/^\/(routes|consumers|secrets|services)\/.+/.test(path)) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
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
const itemRow = (page: Page, path: string) => modal(page).getByRole('row').filter({ hasText: path });

test('preview classifies new, changed, unchanged and blocked destinations without writing', async ({ page }) => {
  const controls = await setup(page, makeData([
    { id: 'new', uri: '/new' }, { id: 'changed', uri: '/changed', desc: 'After' },
    { id: 'same', uri: '/same' }, { id: 'blocked', uri: '/blocked' },
  ]), { '/routes/changed': { id: 'changed', uri: '/changed', desc: 'Before', create_time: 1 }, '/routes/same': { uri: '/same', update_time: 2 } });
  controls.failures.set('/routes/blocked', 503);
  await preview(page);
  await expect(itemRow(page, '/routes/new')).toContainText('New');
  await expect(itemRow(page, '/routes/changed')).toContainText('Changed');
  await expect(itemRow(page, '/routes/same')).toContainText('Unchanged');
  await expect(itemRow(page, '/routes/blocked')).toContainText('Blocked');
  expect(controls.writes).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('import-preview.png'), animations: 'disabled' });
  await itemRow(page, '/routes/changed').getByRole('button', { name: 'Compare JSON' }).click();
  const diff = page.getByRole('dialog', { name: 'Import JSON comparison' });
  await expect(diff).toBeVisible();
  await expect(diff.getByText(/Fields absent from the imported payload may be removed/)).toBeVisible();
  await diff.getByRole('button', { name: 'Back to import preview' }).click();
  await modal(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(controls.writes).toEqual([]);
});

test('import skips unchanged records and reports unreadable items as errors', async ({ page }) => {
  const controls = await setup(page, makeData([
    { id: 'new', uri: '/new' }, { id: 'same', uri: '/same' }, { id: 'blocked', uri: '/blocked' },
  ]), { '/routes/same': { uri: '/same' } });
  controls.failures.set('/routes/blocked', 403);
  await preview(page);
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 1 succeeded, 1 failed, 1 unchanged')).toBeVisible();
  expect(controls.writes).toEqual([{ path: '/routes/new', body: { uri: '/new' } }]);
});

test('a destination changed after preview is not overwritten', async ({ page }) => {
  const controls = await setup(page, makeData([{ id: 'changed', uri: '/after' }]), { '/routes/changed': { uri: '/before' } });
  await preview(page);
  controls.records.set('/routes/changed', { uri: '/edited-elsewhere' });
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 0 succeeded, 1 failed')).toBeVisible();
  await page.getByRole('button', { name: 'Expand row' }).click();
  await expect(page.getByText(/Resource changed after preview/)).toBeVisible();
  expect(controls.writes).toEqual([]);
});

test('a newly created destination after preview is not overwritten', async ({ page }) => {
  const controls = await setup(page, makeData([{ id: 'new', uri: '/new' }]));
  await preview(page);
  controls.records.set('/routes/new', { uri: '/created-elsewhere' });
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 0 succeeded, 1 failed')).toBeVisible();
  expect(controls.writes).toEqual([]);
});

test('new fields and removed fields are both classified as changes', async ({ page }) => {
  await setup(page, makeData([{ id: 'added', uri: '/added', desc: 'Added' }, { id: 'removed', uri: '/removed' }]), {
    '/routes/added': { uri: '/added' }, '/routes/removed': { uri: '/removed', desc: 'Will be removed' },
  });
  await preview(page);
  await expect(itemRow(page, '/routes/added')).toContainText('Changed');
  await expect(itemRow(page, '/routes/removed')).toContainText('Changed');
});

test('duplicate destinations and missing IDs are blocked before any request is written', async ({ page }) => {
  const controls = await setup(page, makeData([{ id: 'duplicate', uri: '/a' }, { id: 'duplicate', uri: '/b' }, { uri: '/no-id' }]));
  await preview(page);
  await expect(modal(page).getByText('Duplicate destination in this import file')).toHaveCount(2);
  await expect(modal(page).getByText('Resource requires a valid ID')).toBeVisible();
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  expect(controls.writes).toEqual([]);
});

test('failed preflight reads never write even after a successful preview', async ({ page }) => {
  const controls = await setup(page, makeData([{ id: 'new', uri: '/new' }]));
  await preview(page);
  controls.failures.set('/routes/new', 503);
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 0 succeeded, 1 failed')).toBeVisible();
  expect(controls.writes).toEqual([]);
});

test('import preview remains inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, makeData([{ id: 'new-route-with-a-long-identifier', uri: '/new' }]));
  await preview(page);
  const bounds = await modal(page).boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeInViewport();
});

test('consumer identity remains in PUT payloads and child paths are encoded', () => {
  expect(getImportRequest('consumers', { username: 'alice', desc: 'Example', create_time: 1 })).toEqual({
    url: '/consumers/alice', body: { username: 'alice', desc: 'Example' },
  });
  expect(getImportRequest('credentials', { username: 'alice smith', id: 'main?key', plugins: {} }).url)
    .toBe('/consumers/alice%20smith/credentials/main%3Fkey');
});
