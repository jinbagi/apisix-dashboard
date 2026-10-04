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

import { type ExportData, IMPORT_ORDER } from '@/apis/export-import';
import { excludedCoverage, type ExportCoverage } from '@/utils/exportCoverage';

async function setup(page: Page) {
  const controls = { invalidSecondPage: false, partial: false, downloads: 0, writes: [] as string[] };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('coverage-ui-fixture')));
  page.on('download', () => controls.downloads++);
  await page.route('**/apisix/admin/**', (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace('/apisix/admin', '');
    if (request.method() !== 'GET') controls.writes.push(path);
    if (path === '/plugins') return route.fulfill({ json: {} });
    if (path === '/ssls' && controls.partial) return route.fulfill({ status: 503, json: { error_msg: 'Fixture unavailable' } });
    if (path === '/routes') {
      const second = url.searchParams.get('page') === '2';
      const list = controls.invalidSecondPage ? second ? [] : Array.from({ length: 100 }, (_, index) => ({ value: { id: String(index), uri: `/${index}` } })) : [{ value: { id: 'one', uri: '/one' } }];
      return route.fulfill({ json: { list, total: controls.invalidSecondPage ? 101 : 1 } });
    }
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('export_import'); return controls;
}
const selected = (id: string): ExportData => {
  const resources = Object.fromEntries(IMPORT_ORDER.map((kind) => [kind, kind === 'routes' ? [{ id, uri: `/${id}` }] : []])) as unknown as ExportData['resources'];
  const collections = Object.fromEntries(IMPORT_ORDER.map((kind) => [kind, excludedCoverage()])) as ExportCoverage['collections'];
  collections.routes = { scope: { type: 'ids', values: [`/routes/${id}`] }, state: 'complete', count: 1 };
  return { version: 3, exportedAt: '2026-10-04T00:00:00Z', resources, coverage: { version: 1, mode: 'selected', rootUrls: [`/routes/${id}`], selectedResources: ['routes'], collections } };
};
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Compare configuration snapshots', exact: true });
async function upload(page: Page, side: number, data: unknown) {
  await dialog(page).locator('input[type="file"]').nth(side).setInputFiles({ name: 'scope.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
}

test('a truncated full-export page gives a useful error and produces no download or mutation', async ({ page }) => {
  const controls = await setup(page); controls.invalidSecondPage = true;
  await page.getByRole('button', { name: 'Export All Resources', exact: true }).click();
  await expect(page.getByText(/Could not verify the complete collection.*No file was exported/)).toBeVisible();
  expect(controls.downloads).toBe(0); expect(controls.writes).toEqual([]);
});

test('first-page endpoint failure downloads a clearly incomplete scope while successful collections remain complete', async ({ page }) => {
  const controls = await setup(page); controls.partial = true;
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export All Resources', exact: true }).click();
  const stream = await (await downloading).createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const file = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ExportData;
  expect(file.coverage?.collections.ssls).toMatchObject({ state: 'incomplete', count: 0 });
  expect(file.coverage?.collections.routes).toMatchObject({ state: 'complete', count: 1 });
  await expect(page.getByText('Exported with 1 skipped: ssls', { exact: true })).toBeVisible(); expect(controls.writes).toEqual([]);
});

test('different selected scopes show Not comparable with inspectable exact IDs and report metadata', async ({ page }) => {
  await setup(page); await page.getByRole('button', { name: 'Compare snapshots', exact: true }).click();
  await upload(page, 0, selected('one')); await upload(page, 1, selected('two'));
  await expect(dialog(page).getByText('Not comparable: 2', { exact: true })).toBeVisible();
  await expect(dialog(page).getByText('Removed: 0', { exact: true })).toBeVisible();
  await dialog(page).getByText('Collection coverage: only equal complete scopes establish absence', { exact: true }).click();
  const row = dialog(page).getByRole('row').filter({ has: page.getByRole('cell', { name: 'Routes', exact: true }) });
  await row.getByText('Inspect scope and owners', { exact: true }).click();
  await expect(row.getByLabel('Coverage scope routes')).toContainText('/routes/one');
  await expect(row.getByLabel('Coverage scope routes')).toContainText('/routes/two');
  await page.screenshot({ path: test.info().outputPath('export-coverage.png'), animations: 'disabled' });
});

test('legacy warnings explain unknown absence and the footer remains reachable at narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 }); await setup(page);
  await page.getByRole('button', { name: 'Compare snapshots', exact: true }).click();
  const before = { ...selected('one'), coverage: undefined }; const after = { ...selected('two'), coverage: undefined };
  await upload(page, 0, before); await upload(page, 1, after);
  await expect(dialog(page).getByText('Not comparable: 2', { exact: true })).toBeVisible();
  await expect(dialog(page).getByText(/Legacy export coverage is unknown/)).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  const close = await dialog(page).getByRole('button', { name: 'Close comparison', exact: true }).boundingBox();
  expect(close!.y + close!.height).toBeLessThanOrEqual(640);
  expect(await dialog(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('export-coverage-narrow.png'), animations: 'disabled' });
});
