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

const catalog = Array.from({ length: 25 }, (_, index) => ({
  id: `catalog-${String(index + 1).padStart(2, '0')}`,
  name: `Catalog ${String(index + 1).padStart(2, '0')}`,
  uri: `/catalog/${index + 1}`, hosts: ['api.example.test'],
  labels: { env: 'prod' }, plugins: {}, create_time: 1, update_time: 2,
}));

async function mockAdmin(page: Page, options: { failPage?: boolean; failAll?: boolean; pauseSearch?: Promise<void> } = {}) {
  const reads: string[] = [];
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/apisix/admin', '');
    if (request.method() !== 'GET') writes.push(path);
    const isSearch = url.searchParams.get('page_size') === '500';
    if (isSearch) reads.push(path + url.search);
    if (isSearch && path === '/routes' && options.pauseSearch) await options.pauseSearch;
    if (isSearch && (options.failAll || (options.failPage && path === '/routes' && url.searchParams.get('page') === '2'))) {
      return route.fulfill({ status: 503, json: { error_msg: 'Search page unavailable' } });
    }
    if (path === '/plugins') return route.fulfill({ json: {} });
    const list = path === '/routes' ? catalog
      : path === '/services' ? [{ id: 'catalog-service', name: 'Catalog Service', plugins: {}, create_time: 1, update_time: 2 }]
      : path === '/secrets' ? [{ id: 'shared', manager: 'vault' }, { id: 'shared', manager: 'aws' }] : [];
    if (/\/(detail|catalog-)/.test(path) || path.split('/').length > 2) {
      return route.fulfill({ json: { value: catalog.find((item) => path.endsWith(item.id)) ?? catalog[0] } });
    }
    return route.fulfill({ json: {
      total: options.failPage && path === '/routes' && isSearch ? 501 : list.length,
      list: isSearch && url.searchParams.get('page') === '2' ? [] : list.map((value) => ({ value })),
    } });
  });
  return { reads, writes, options };
}

async function openSearch(page: Page) {
  await page.getByRole('button', { name: 'Search resources', exact: true }).click();
  return page.getByRole('combobox', { name: 'Search all resources', exact: true });
}

async function chooseScope(page: Page, label: string) {
  const picker = page.getByRole('combobox', { name: 'Resource type', exact: true });
  await picker.click();
  await picker.fill(label);
  await page.locator('.ant-select-dropdown').getByText(label, { exact: true }).click();
}

test('opens useful keyboard navigation without requesting a gateway search', async ({ page }) => {
  const state = await mockAdmin(page);
  await page.goto('routes');
  await page.getByRole('button', { name: 'Search resources' }).press('Control+k');
  const input = page.getByRole('combobox', { name: 'Search all resources' });
  await expect(input).toBeFocused();
  await expect(page.getByRole('option', { name: 'Browse Routes', exact: false })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/services(?:\?|$)/);
  expect(state.reads).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('opens a creation draft without submitting and returns focus on Escape', async ({ page }) => {
  const state = await mockAdmin(page);
  await page.goto('routes');
  await openSearch(page);
  await page.getByRole('option', { name: 'Create Upstream', exact: false }).click();
  await expect(page).toHaveURL(/\/upstreams\/add$/);
  expect(state.writes).toEqual([]);
  const input = await openSearch(page);
  await input.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search resources' })).toBeFocused();
});

test('shows result context and reveals every result beyond the first 20', async ({ page }, testInfo) => {
  await mockAdmin(page);
  await page.goto('routes');
  const input = await openSearch(page);
  await input.fill('catalog');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('26 results');
  const list = page.getByRole('listbox', { name: 'Resource results' });
  await expect(list.getByRole('option')).toHaveCount(20);
  await expect(list).toContainText('/catalog/1');
  await page.getByRole('button', { name: 'Show more (6 remaining)' }).click();
  await expect(list.getByRole('option')).toHaveCount(26);
  await expect(page.getByRole('button', { name: /Show more/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('resource-search.png') });
});

test('scopes requests and reuses successful collections while refining a query', async ({ page }) => {
  const state = await mockAdmin(page);
  await page.goto('routes');
  const input = await openSearch(page);
  await chooseScope(page, 'Services');
  await input.fill('catalog');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('1 result');
  expect(state.reads).toHaveLength(1);
  expect(state.reads[0]).toContain('/services?');
  await input.fill('catalog service');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('1 result');
  expect(state.reads).toHaveLength(1);
  await input.press('Escape');
  await openSearch(page);
  await chooseScope(page, 'Services');
  await input.fill('catalog');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('1 result');
  expect(state.reads).toHaveLength(2);
});

test('opens an exact resource match with Enter', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('routes');
  const input = await openSearch(page);
  await input.fill('catalog-25');
  await expect(page.getByRole('option', { name: /Catalog 25/ })).toBeVisible();
  await input.press('Enter');
  await expect(page).toHaveURL(/\/routes\/detail\/catalog-25$/);
});

test('finishes an in-flight search when only query case or surrounding whitespace changes', async ({ page }) => {
  let releaseSearch!: () => void;
  const pauseSearch = new Promise<void>((resolve) => { releaseSearch = resolve; });
  const state = await mockAdmin(page, { pauseSearch });
  await page.goto('routes');
  const input = await openSearch(page);
  await input.fill('catalog');
  await expect.poll(() => state.reads.length).toBe(12);
  await input.fill(' CATALOG ');
  releaseSearch();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('26 results');
  expect(state.reads.filter((path) => path.startsWith('/routes?'))).toHaveLength(1);
});

test('cannot open a previous result after the search input changes', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('routes');
  const input = await openSearch(page);
  await input.fill('catalog-25');
  await expect(page.getByRole('option', { name: /Catalog 25/ })).toBeVisible();
  await input.fill('missing');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/routes(?:\?|$)/);
  await expect(page.getByText('No results found', { exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: /Catalog 25/ })).toHaveCount(0);
});

test('preserves an unsaved editor draft when quick navigation is cancelled', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('routes/add');
  await page.getByLabel('Name', { exact: true }).fill('Unsaved draft');
  await openSearch(page);
  await page.getByRole('option', { name: /Browse Services/ }).click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page).toHaveURL(/\/routes\/add$/);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Unsaved draft');
});

test('reports missing result pages and retries without concealing available matches', async ({ page }) => {
  const state = await mockAdmin(page, { failPage: true });
  await page.goto('routes');
  const input = await openSearch(page);
  await chooseScope(page, 'Routes');
  await input.fill('catalog');
  await expect(page.getByText('Results may be incomplete')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('25 available results');
  state.options.failPage = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Results may be incomplete')).toHaveCount(0);
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('25 results');
});

test('keeps unavailable search distinct from no matches and lets users clear a search', async ({ page }) => {
  const state = await mockAdmin(page, { failAll: true });
  await page.goto('routes');
  const input = await openSearch(page);
  await input.fill('missing');
  await expect(page.getByText('Search unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('No results found', { exact: true })).toHaveCount(0);
  state.options.failAll = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('No results found', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByRole('option', { name: /Browse Routes/ })).toBeVisible();
  await expect(input).toHaveValue('');
});

test('keeps same-id secrets under separate managers as separate options', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('routes');
  const input = await openSearch(page);
  await chooseScope(page, 'Secrets');
  await input.fill('shared');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('2 results');
  await expect(page.getByRole('listbox', { name: 'Resource results' }).getByRole('option')).toHaveCount(2);
});

test('handles whitespace and empty keyboard navigation without producing an invalid selection', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('routes');
  const input = await openSearch(page);
  await input.fill('   ');
  await expect(page.getByRole('option', { name: /Browse Routes/ })).toBeVisible();
  await input.fill('missing');
  await expect(page.getByText('No results found', { exact: true })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(input).not.toHaveAttribute('aria-activedescendant');
});

for (const theme of ['light', 'dark']) {
  test(`keeps search available and inside a narrow viewport in ${theme} theme`, async ({ page }, testInfo) => {
    await mockAdmin(page);
    await page.addInitScript((mode) => localStorage.setItem('theme', JSON.stringify(mode)), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('routes');
    const input = await openSearch(page);
    await input.fill('catalog');
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('26 results');
    const dialog = page.getByRole('dialog');
    const bounds = await dialog.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath(`search-narrow-${theme}.png`) });
  });
}
