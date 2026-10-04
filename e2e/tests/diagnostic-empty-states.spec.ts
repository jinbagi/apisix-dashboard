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

const genericEmpty = 'No items yet. Use the Add button above to create one.';
const routes = Array.from({ length: 14 }, (_, index) => ({ id: `route-${index}`, name: `Catalog ${index}`, uri: `/catalog-${index}`, host: 'example.com', status: index === 13 ? 0 : 1 }));
async function mock(page: Page, options: { empty?: boolean; unavailable?: string; brokenGlobal?: boolean } = {}) {
  const writes: string[] = [];
  const records: Record<string, Record<string, unknown>[]> = {
    routes: options.empty ? [] : routes,
    global_rules: options.brokenGlobal ? [{ id: 'global', plugins: { 'grpc-transcode': { proto_id: 'missing' } } }] : [],
  };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('diagnostic-empty-fixture')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    const path = url.pathname.replace('/apisix/admin/', '');
    if (request.method() !== 'GET') { writes.push(path); return route.fulfill({ status: 500, json: { error_msg: 'Fixture forbids writes' } }); }
    if (path === options.unavailable) return route.fulfill({ status: 503, json: { error_msg: 'Fixture unavailable collection' } });
    if (path === 'plugins/list') return route.fulfill({ json: [] });
    const values = records[path] ?? [];
    const size = Number(url.searchParams.get('page_size') || 100); const start = (Number(url.searchParams.get('page') || 1) - 1) * size;
    return route.fulfill({ json: { list: values.slice(start, start + size).map((value) => ({ value })), total: values.length } });
  });
  return writes;
}
async function requestPreview(page: Page) {
  await page.goto('routes');
  await page.getByRole('button', { name: 'Preview request matching', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Request matching preview', exact: true });
  await dialog.getByLabel('Host name', { exact: true }).fill('example.com');
  await dialog.getByLabel('Normalized URI path', { exact: true }).fill('/api/identity/sign-out');
  await dialog.getByRole('combobox', { name: 'Configured HTTP router', exact: true }).click();
  await page.locator('.ant-select-item-option-content').filter({ hasText: /^radixtree_uri$/ }).click();
  await dialog.getByRole('button', { name: 'Preview candidates', exact: true }).click();
  await expect(dialog.getByRole('status')).toBeVisible();
  return dialog;
}

test('request preview explains zero candidates without implying no saved resources', async ({ page }, info) => {
  const writes = await mock(page); const dialog = await requestPreview(page);
  await expect(dialog.getByRole('status')).toContainText('0 candidate(s) / 0 runtime check(s) / 14 excluded');
  await page.screenshot({ path: info.outputPath('request-empty.png'), animations: 'disabled' });
  await expect(dialog.getByText(genericEmpty, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('No candidates for these request inputs.', { exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Show excluded and disabled Routes' }).check();
  await expect(dialog.getByText('Catalog 0 / route-0', { exact: true })).toBeVisible();
  await expect(dialog.getByText('No candidates for these request inputs.', { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('an empty Route collection has specific request-preview guidance on a narrow screen', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await mock(page, { empty: true }); const dialog = await requestPreview(page);
  await expect(dialog.getByRole('status')).toContainText('Read 0 Routes');
  await expect(dialog.getByText(genericEmpty, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('No saved HTTP Routes to preview.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('No candidates in the supported conditions', { exact: true })).toHaveCount(0);
  await dialog.getByText('No saved HTTP Routes to preview.', { exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Close request preview', exact: true })).toBeInViewport();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('request-empty-narrow.png'), animations: 'disabled' });
  expect(writes).toEqual([]);
});

test('overlap comparison distinguishes no candidates from no resources', async ({ page }, info) => {
  const writes = await mock(page); await page.goto('routes');
  await page.getByRole('button', { name: 'Check route overlaps', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Route overlap candidates', exact: true });
  await expect(dialog.getByRole('status')).toContainText('0 candidate(s) / 12 other enabled Route(s) compared / 1 disabled');
  await expect(dialog).not.toHaveClass(/ant-zoom-(enter|appear)/);
  await page.screenshot({ path: info.outputPath('overlap-empty.png'), animations: 'disabled' });
  await expect(dialog.getByText(genericEmpty, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('No overlap candidates in the checked conditions.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('No overlaps found in the checked scope', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

for (const unavailable of [false, true]) test(`reference diagnostics keeps empty findings ${unavailable ? 'incomplete' : 'scope-limited'}`, async ({ page }) => {
  const writes = await mock(page, { unavailable: unavailable ? 'protos' : undefined });
  await page.goto('dashboard'); await page.getByRole('button', { name: 'Check references', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configuration reference diagnostics', exact: true });
  await expect(dialog.getByRole('status')).toHaveText(`0 reference issue(s) / ${unavailable ? 1 : 0} unavailable collection(s)`);
  await expect(dialog.getByText(genericEmpty, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(unavailable ? 'No findings to display from available collections. Retry the reference check to include unavailable collections.' : 'No reference issues in the checked scope.', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('affected Route filtering explains zero matches and clearing restores the list', async ({ page }) => {
  const writes = await mock(page, { brokenGlobal: true });
  await page.goto('dashboard'); await page.getByRole('button', { name: 'Check references', exact: true }).click();
  const diagnostics = page.getByRole('dialog', { name: 'Configuration reference diagnostics', exact: true });
  await diagnostics.getByRole('button', { name: 'View affected routes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Potentially affected routes', exact: true });
  await dialog.getByRole('searchbox', { name: 'Filter affected routes', exact: true }).fill('no-such-route');
  await expect(dialog.getByText(genericEmpty, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('No affected Routes match this filter.', { exact: true })).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Filter affected routes', exact: true }).fill('');
  await expect(dialog.getByRole('link', { name: '/routes/route-0', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

