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

const resources = Array.from({ length: 25 }, (_, index) => ({
  id: `table-${String(index + 1).padStart(2, '0')}`,
  name: `Catalog route ${String(index + 1).padStart(2, '0')}`,
  username: `consumer-${index + 1}`,
  service_id: index % 2 ? 'service-a' : 'service-b',
  manager: 'vault',
  uri: `/catalog/${index + 1}/*`,
  snis: ['catalog.example.test'],
  server_addr: '127.0.0.1',
  server_port: 9000,
  type: 'roundrobin',
  scheme: 'http',
  status: index === 0 ? undefined : index % 2,
  plugins: {},
  labels: { env: index % 2 ? 'prod' : 'staging' },
  nodes: { '127.0.0.1:1980': 1 },
  upstream: { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } },
  content: 'syntax = "proto3";',
  create_time: 1790982000 + index,
  update_time: 1790982060 + index,
}));

async function mockAdmin(
  page: Page,
  options: { empty?: boolean; failSearchPage?: boolean; multiplePages?: boolean } = {},
) {
  const reads: string[] = [];
  const writes: string[] = [];
  await page.addInitScript(() =>
    localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')),
  );
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/apisix/admin', '');
    if (request.method() !== 'GET') writes.push(path);
    reads.push(url.pathname + url.search);
    if (path === '/plugins') return route.fulfill({ json: {} });
    if (
      /^\/(routes|upstreams|services|consumers|consumer_groups|ssls|secrets|global_rules|plugin_configs|protos|stream_routes)$/.test(
        path,
      )
    ) {
      const pageNumber = Number(url.searchParams.get('page') || 1);
      const size = Number(url.searchParams.get('page_size') || 10);
      if (options.failSearchPage && pageNumber === 2 && size === 500)
        return route.fulfill({
          status: 503,
          json: { error_msg: 'A result page is unavailable' },
        });
      const label = url.searchParams.get('label');
      const serviceId = new URLSearchParams(url.searchParams.get('filter') ?? '').get('service_id');
      const collection = options.multiplePages ? Array.from({ length: 525 }, (_, index) => ({
        ...resources[index % resources.length],
        id: `large-${index + 1}`,
        name: `Large route ${index + 1}`,
        plugins: index === 524 ? { 'limit-count': { count: 10 } } : {},
      })) : resources;
      const list = options.empty
        ? []
        : collection.filter(
            (row) => (!label || Object.hasOwn(row.labels, label)) && (!serviceId || row.service_id === serviceId),
          );
      return route.fulfill({
        json: {
          total: options.failSearchPage ? 501 : list.length,
          list: list
            .slice((pageNumber - 1) * size, pageNumber * size)
            .map((value) => ({ value })),
        },
      });
    }
    return route.fulfill({ json: { value: resources[0], list: [], total: 0 } });
  });
  return { reads, writes };
}

async function filterStatus(page: Page, status: 'Enabled' | 'Disabled') {
  await page.getByRole('columnheader', { name: 'Status filter', exact: true }).getByRole('button', { name: 'filter' }).click();
  await page.getByRole('menuitem', { name: status, exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
}

test('label key and exact value searches follow APISIX label-key semantics', async ({ page }) => {
  const { reads } = await mockAdmin(page);
  await page.goto('routes?label=env');
  await expect(page.getByText('1–10 of 25 items', { exact: true })).toBeVisible();
  const before = reads.length;
  const label = page.getByRole('searchbox', { name: 'Label', exact: true });
  await label.fill('env:prod');
  await label.press('Enter');
  await expect(page.getByText('1–10 of 12 items', { exact: true })).toBeVisible();
  await label.fill('env:staging');
  await label.press('Enter');
  await expect(page.getByText('1–10 of 13 items', { exact: true })).toBeVisible();
  expect(reads.length).toBe(before);
  expect(reads.filter((url) => url.startsWith('/apisix/admin/routes?') && url.includes('page_size=500')).every((url) => new URL(url, 'http://localhost').searchParams.get('label') === 'env')).toBe(true);
});

test('saved service route views retain the current service reference filter', async ({ page }) => {
  const { reads } = await mockAdmin(page);
  await page.goto('services/detail/service-a/routes');
  await expect(page.getByText('1–10 of 12 items', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save table view' });
  await dialog.getByRole('textbox', { name: 'View name' }).fill('Service routes');
  await dialog.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.goto('services/detail/service-b/routes');
  await page.getByRole('combobox', { name: 'Saved views', exact: true }).click();
  await page.getByRole('option', { name: 'Service routes', exact: true }).click();
  await expect(page.getByText('1–10 of 13 items', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Catalog route 02', exact: true })).toHaveCount(0);
  expect(reads.filter((url) => url.startsWith('/apisix/admin/routes?') && url.includes('page_size=500')).every((url) => new URL(url, 'http://localhost').searchParams.has('filter'))).toBe(true);
});

test('collections beyond one Admin API page supply complete sort and plugin filter options', async ({ page }) => {
  const { reads } = await mockAdmin(page, { multiplePages: true });
  await page.goto('routes?sort_by=name&sort_order=desc');
  await expect(page.locator('.resource-table-name a').first()).toHaveText('Large route 525');
  await expect(page.getByText('1–10 of 525 items', { exact: true })).toBeVisible();
  expect(reads.some((url) => url.includes('page=2') && url.includes('page_size=500'))).toBe(true);
  await page.getByRole('columnheader', { name: 'Plugins filter', exact: true }).getByRole('button', { name: 'filter' }).click();
  await page.getByRole('menuitem', { name: 'limit-count', exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByText('1–1 of 1 items', { exact: true })).toBeVisible();
  await expect(page.locator('.resource-table-name a')).toHaveText(['Large route 525']);
});

test('unavailable browser storage reports a save failure and leaves the table usable', async ({ page }) => {
  await mockAdmin(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('resource-table:saved-views:')) throw new DOMException('Storage full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.goto('routes');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save table view' });
  await dialog.getByRole('textbox', { name: 'View name' }).fill('Unsaved');
  await dialog.getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Your view could not be saved');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Catalog route 01', exact: true })).toBeVisible();
});

test('sorting and column filtering paginate the whole result set and preserve URL history', async ({ page }) => {
  const { reads, writes } = await mockAdmin(page);
  await page.goto('routes?page=2&page_size=10');
  await expect(page.getByRole('link', { name: 'Catalog route 11', exact: true })).toBeVisible();
  const before = reads.length;
  await page.getByRole('combobox', { name: 'Sort results', exact: true }).click();
  await page.getByRole('option', { name: 'Name (Z-A)', exact: true }).click();
  const names = page.locator('.resource-table-name a');
  await expect(names.first()).toHaveText('Catalog route 25');
  await page.getByRole('listitem', { name: '2', exact: true }).click();
  await expect(names.first()).toHaveText('Catalog route 15');
  await filterStatus(page, 'Disabled');
  await expect(names.first()).toHaveText('Catalog route 25');
  await expect(page.getByText('1–10 of 12 items', { exact: true })).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get('page') === '1' && url.searchParams.has('column_filters'));
  expect(reads.length).toBe(before);
  expect(reads.every((url) => !url.includes('sort_by') && !url.includes('column_filters'))).toBe(true);
  await page.getByRole('listitem', { name: '2', exact: true }).click();
  await expect(names).toHaveText(['Catalog route 05', 'Catalog route 03']);
  await page.reload();
  await expect(names).toHaveText(['Catalog route 05', 'Catalog route 03']);
  await page.getByRole('region', { name: 'Active filters' }).getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('1–10 of 25 items', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('region', { name: 'Active filters' })).toContainText('Status: Disabled');
  await expect(names).toHaveText(['Catalog route 05', 'Catalog route 03']);
  expect(writes).toEqual([]);
});

test('named views restore search, labels, sort, filters, page size, columns, and spacing after reload', async ({ page }) => {
  const { writes } = await mockAdmin(page);
  await page.goto('routes?q=Catalog&label=env%3Aprod&sort_by=name&sort_order=desc&page_size=20');
  await filterStatus(page, 'Enabled');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Table view settings' });
  await settings.getByRole('checkbox', { name: 'Host', exact: true }).check();
  await settings.getByText('Compact', { exact: true }).click();
  await settings.getByRole('checkbox', { name: 'Host', exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save table view' });
  await dialog.getByRole('textbox', { name: 'View name' }).fill('Production routes');
  await dialog.getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(dialog).toBeHidden();
  const views = page.getByRole('region', { name: 'Saved table views' });
  await expect(views.getByText('Modified', { exact: true })).toHaveCount(0);
  await page.getByRole('region', { name: 'Active filters' }).getByRole('button', { name: 'Clear filters' }).click();
  await expect(views.getByText('Modified', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('combobox', { name: 'Saved views', exact: true }).click();
  await page.getByRole('option', { name: 'Production routes', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toHaveValue('Catalog');
  await expect(page.getByRole('searchbox', { name: 'Label', exact: true })).toHaveValue('env:prod');
  await expect(page.getByRole('region', { name: 'Active filters' })).toContainText('Status: Enabled');
  await expect(page.getByText('1–12 of 12 items', { exact: true })).toBeVisible();
  await expect(page.locator('.resource-table-name a').first()).toHaveText('Catalog route 24');
  await expect(page.getByRole('columnheader', { name: 'Host', exact: true })).toBeVisible();
  await expect(page.locator('.ant-table-small')).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get('page_size') === '20' && url.searchParams.get('sort_order') === 'desc');
  await expect(views.getByText('Modified', { exact: true })).toHaveCount(0);
  await page.getByRole('region', { name: 'Active filters' }).getByRole('button', { name: 'Clear filters' }).click();
  await views.getByRole('button', { name: 'Restore view' }).click();
  await expect(page.getByRole('searchbox', { name: 'Label', exact: true })).toHaveValue('env:prod');
  await views.getByRole('button', { name: 'Save view', exact: true }).click();
  await dialog.getByRole('button', { name: 'Update view', exact: true }).press('Enter');
  await expect(dialog).toBeHidden();
  await views.getByRole('button', { name: 'Delete view', exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: 'Delete view', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Label', exact: true })).toHaveValue('env:prod');
  await page.reload();
  await page.getByRole('combobox', { name: 'Saved views', exact: true }).click();
  await expect(page.getByText('No saved views yet', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('selection clears when sorting or restoring a view, and views stay scoped to their table', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('routes');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save table view' });
  await dialog.getByRole('textbox', { name: 'View name' }).fill('Route workspace');
  await dialog.getByRole('button', { name: 'Save view', exact: true }).click();
  const firstRow = page.getByRole('row').filter({ hasText: 'Catalog route 01' });
  await firstRow.getByRole('checkbox').check();
  const selection = page.getByRole('region', { name: 'Selected resource actions' });
  await expect(selection).toBeVisible();
  await page.getByRole('combobox', { name: 'Sort results', exact: true }).click();
  await page.getByRole('option', { name: 'Name (Z-A)', exact: true }).click();
  await expect(selection).toHaveCount(0);
  await page.getByRole('row').filter({ hasText: 'Catalog route 25' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Restore view' }).click();
  await expect(selection).toHaveCount(0);
  await page.goto('services');
  await page.getByRole('combobox', { name: 'Saved views', exact: true }).click();
  await expect(page.getByText('No saved views yet', { exact: true })).toBeVisible();
});

test('invalid saved views and malformed filter URLs recover without breaking the table', async ({ page }) => {
  await mockAdmin(page);
  await page.addInitScript(() => {
    localStorage.setItem('resource-table:saved-views:v1:resource-table:v1:table-v6:routes', JSON.stringify([{ name: 'Broken', snapshot: { search: {} } }]));
  });
  await page.goto('routes?column_filters=broken&page=999');
  await expect(page.getByText('21–25 of 25 items', { exact: true })).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get('page') === '3');
  await page.getByRole('combobox', { name: 'Saved views', exact: true }).click();
  await expect(page.getByText('No saved views yet', { exact: true })).toBeVisible();
});

for (const [path, title, primary] of [
  ['routes', 'Routes', 'Name'],
  ['upstreams', 'Upstreams', 'Name'],
  ['services', 'Services', 'Name'],
  ['consumers', 'Consumers', 'Username'],
  ['consumer_groups', 'Consumer Groups', 'Name'],
  ['stream_routes', 'Stream Routes', 'ID'],
  ['ssls', 'SSLs', 'ID'],
  ['secrets', 'Secrets', 'ID'],
  ['global_rules', 'Global Rules', 'ID'],
  ['plugin_configs', 'Plugin Configs', 'Name'],
  ['protos', 'Protos', 'Name'],
]) {
  test(`${title} uses the shared table controls and keeps RAW immediately before resource identity`, async ({
    page,
  }) => {
    await mockAdmin(page);
    await page.goto(path);
    const table = page.getByRole('region', {
      name: `${title} list`,
      exact: true,
    });
    await expect(
      table.getByRole('button', { name: 'Refresh', exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole('button', { name: 'View', exact: true }),
    ).toBeVisible();
    const headers = await table.getByRole('columnheader').allTextContents();
    expect(headers.indexOf(primary)).toBe(headers.indexOf('RAW') + 1);

    await expect(
      table.getByRole('columnheader', { name: 'ID', exact: true }),
    ).toHaveCount(primary === 'Name' || primary === 'Username' ? 0 : 1);
  });
}

test('view settings persist, restore defaults, and support Escape focus return', async ({
  page,
}) => {
  await mockAdmin(page);
  await page.goto('routes');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Table view settings' });
  await settings.getByRole('checkbox', { name: 'ID', exact: true }).check();
  await settings.getByText('Compact', { exact: true }).click();
  await settings
    .getByRole('checkbox', { name: 'Created At', exact: true })
    .check();
  await settings
    .getByRole('checkbox', { name: 'Created At', exact: true })
    .press('Escape');
  await expect(
    page.getByRole('button', { name: 'View', exact: true }),
  ).toBeFocused();
  await expect(settings).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole('columnheader', { name: 'ID', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: 'Created At', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.ant-table-small')).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await settings.getByRole('button', { name: 'Reset view' }).click();
  await expect(
    settings.getByRole('radio', { name: 'Default', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('columnheader', { name: 'ID', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('columnheader', { name: 'Created At', exact: true }),
  ).toHaveCount(0);
});

test('search finds resources on later pages and empty results offer filter recovery', async ({
  page,
}) => {
  const { reads } = await mockAdmin(page);
  await page.goto('routes?page=2&page_size=10');
  const search = page.getByRole('searchbox', { name: 'Search', exact: true });
  await search.fill('Catalog route 23');
  await search.press('Enter');
  await expect(
    page.getByRole('link', { name: 'Catalog route 23', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('page') === '1' &&
      url.searchParams.get('q') === 'Catalog route 23',
  );
  expect(reads.some((url) => url.includes('page_size=500'))).toBe(true);
  await search.fill('no-such-resource');
  await search.press('Enter');
  await expect(
    page.getByText('No matching resources', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('No resources yet', { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole('region', { name: 'Active filters' })
    .getByRole('button', { name: 'Clear filters' })
    .click();
  await expect(search).toHaveValue('');
  await expect(
    page.getByRole('link', { name: 'Catalog route 01', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      !url.searchParams.has('q') && url.searchParams.get('page_size') === '10',
  );
});

test('an empty collection is distinct from a filtered empty result', async ({
  page,
}) => {
  await mockAdmin(page, { empty: true });
  await page.goto('routes');
  await expect(
    page.getByText('No resources yet', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('link', { name: 'Add Route', exact: true }),
  ).toBeVisible();
});

test('selection has one action region and clears when moving between pages', async ({
  page,
}) => {
  const { writes } = await mockAdmin(page);
  await page.goto('routes');
  await page
    .getByRole('row')
    .filter({ hasText: 'Catalog route 01' })
    .getByRole('checkbox')
    .check();
  const actions = page.getByRole('region', {
    name: 'Selected resource actions',
  });
  await expect(actions).toHaveCount(1);
  await expect(
    actions.getByRole('button', { name: 'Delete', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.ant-pro-table-alert')).toHaveCount(0);
  await actions.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete 1 Route(s)' });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(actions).toBeVisible();
  await page.getByRole('listitem', { name: '2', exact: true }).click();
  await expect(actions).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Catalog route 11', exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByRole('combobox', { name: 'Page Size' }).click();
  await page.getByRole('option', { name: '20 / page', exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('page') === '1' &&
      url.searchParams.get('page_size') === '20',
  );
});

test('labels and search remain synchronized with back navigation and clear filters', async ({
  page,
}) => {
  await mockAdmin(page);
  await page.goto('routes');
  const label = page.getByRole('searchbox', { name: 'Label', exact: true });
  await label.fill('env:prod');
  await label.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Active filters' }),
  ).toContainText('env:prod');
  await expect(
    page.getByRole('link', { name: 'Catalog route 01', exact: true }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(label).toHaveValue('');
  await expect(
    page.getByRole('link', { name: 'Catalog route 01', exact: true }),
  ).toBeVisible();
});

test('refresh is an explicit action and invalid saved preferences fall back safely', async ({
  page,
}) => {
  const { reads } = await mockAdmin(page);
  await page.addInitScript(() => {
    localStorage.setItem('table:pageSize', 'not-a-number');
    localStorage.setItem('resource-table:v1:table-v6:routes', '{bad json');
  });
  await page.goto('routes?page=bad');
  await expect(
    page.getByRole('link', { name: 'Catalog route 01', exact: true }),
  ).toBeVisible();
  const before = reads.filter((url) =>
    url.startsWith('/apisix/admin/routes?'),
  ).length;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect
    .poll(
      () =>
        reads.filter((url) => url.startsWith('/apisix/admin/routes?')).length,
    )
    .toBeGreaterThan(before);
  await expect(page.getByRole('combobox', { name: 'Page Size' })).toBeVisible();
});

test('narrow tables keep controls inside the viewport and allow keyboard horizontal scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAdmin(page);
  await page.goto('routes');
  await expect(page.getByRole('complementary')).toHaveCSS('width', '68px');
  const scroller = page.getByRole('region', { name: /^Routes columns/ });
  await expect(scroller).toHaveAttribute('tabindex', '0');
  const raw = page
    .getByRole('row')
    .filter({ hasText: 'Catalog route 01' })
    .getByRole('button', { name: 'Raw', exact: true });
  await expect(raw).toBeInViewport();
  const rawBefore = await raw.boundingBox();
  await scroller.focus();
  await scroller.press('ArrowRight');
  await expect
    .poll(() => scroller.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
  await expect(raw).toBeInViewport();
  const rawAfter = await raw.boundingBox();
  expect(rawAfter!.x).toBeCloseTo(rawBefore!.x, 0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const name of ['Search', 'Label']) {
    const bounds = await page
      .getByRole('searchbox', { name, exact: true })
      .boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  await page.getByRole('button', { name: 'Switch to Dark Mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('row expansion and the prominent RAW action work without changing selection', async ({
  page,
}) => {
  const { writes } = await mockAdmin(page);
  await page.goto('routes');
  const row = page.getByRole('row').filter({ hasText: 'Catalog route 01' });
  await row.getByRole('button', { name: 'Expand row', exact: true }).click();
  await expect(
    row.getByRole('button', { name: 'Collapse row', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await row.getByRole('button', { name: 'Collapse row', exact: true }).click();
  await expect(
    row.getByRole('button', { name: 'Expand row', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await row.getByRole('button', { name: 'Raw', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: /Route: Catalog route 01/ });
  await expect(drawer).toContainText('/routes/table-01');
  await expect(
    drawer.getByRole('textbox', { name: 'Editor content' }),
  ).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('failed search result pages show an error instead of claiming no matches', async ({
  page,
}) => {
  await mockAdmin(page, { failSearchPage: true });
  await page.goto('routes?q=missing');
  await expect(
    page.getByRole('heading', { name: 'Configuration store unavailable' }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByText('No matching resources', { exact: true }),
  ).toHaveCount(0);
});

test('status filters include implicitly enabled routes and clear without losing the list', async ({
  page,
}) => {
  await mockAdmin(page);
  await page.goto('routes');
  await page
    .getByRole('columnheader', { name: 'Status filter', exact: true })
    .getByRole('button', { name: 'filter' })
    .click();
  await page.getByRole('menuitem', { name: 'Enabled', exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Catalog route 01', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Catalog route 03', exact: true }),
  ).toHaveCount(0);
  const filters = page.getByRole('region', { name: 'Active filters' });
  await expect(filters).toContainText('Status: Enabled');
  await filters.getByRole('button', { name: 'Clear filters' }).click();
  await expect(
    page.getByRole('link', { name: 'Catalog route 03', exact: true }),
  ).toBeVisible();
});


test('column order, width and pins persist in named views without changing resources', async ({ page }, testInfo) => {
  const { writes } = await mockAdmin(page);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('routes');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Table view settings' });
  await settings.getByRole('button', { name: 'Move Target earlier', exact: true }).focus();
  await settings.getByRole('button', { name: 'Move Target earlier', exact: true }).press('Enter');
  let headers = await page.getByRole('columnheader').allTextContents();
  expect(headers.indexOf('Target')).toBeLessThan(headers.indexOf('URI'));
  await settings.getByRole('spinbutton', { name: 'URI width', exact: true }).fill('320');
  await settings.getByRole('spinbutton', { name: 'URI width', exact: true }).press('Tab');
  await expect(settings.getByRole('spinbutton', { name: 'URI width', exact: true })).toHaveValue('320');
  await settings.getByRole('checkbox', { name: 'Host', exact: true }).check();
  await settings.getByRole('combobox', { name: 'Host pin', exact: true }).click();
  await page.getByRole('option', { name: 'Right', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Host', exact: true })).toHaveClass(/ant-table-cell-fix-end/);
  const width = await page.getByRole('columnheader', { name: 'URI', exact: true }).boundingBox();
  expect(width!.width).toBeCloseTo(320, 0);
  await expect(page.getByRole('option', { name: 'Right', exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('table-layout-desktop.png') });
  await settings.getByRole('spinbutton', { name: 'URI width', exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save table view' });
  await dialog.getByRole('textbox', { name: 'View name' }).fill('Routing layout');
  await dialog.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await settings.getByRole('button', { name: 'Reset view' }).click();
  await settings.getByRole('button', { name: 'Reset view' }).press('Escape');
  await expect(page.getByRole('columnheader', { name: 'Host', exact: true })).toHaveCount(0);
  await expect(page.getByText('Modified', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('combobox', { name: 'Saved views', exact: true }).click();
  await page.getByRole('option', { name: 'Routing layout', exact: true }).click();
  await expect(page.getByText('Modified', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Host', exact: true })).toHaveClass(/ant-table-cell-fix-end/);
  headers = await page.getByRole('columnheader').allTextContents();
  expect(headers.indexOf('Target')).toBeLessThan(headers.indexOf('URI'));
  expect(headers.indexOf('Name')).toBe(headers.indexOf('RAW') + 1);
  expect((await page.getByRole('columnheader', { name: 'URI', exact: true }).boundingBox())!.width).toBeCloseTo(320, 0);
  expect(writes).toEqual([]);
});

test('legacy saved views retain filters and visibility with default column layout', async ({ page }) => {
  await mockAdmin(page);
  await page.addInitScript(() => {
    localStorage.setItem('resource-table:saved-views:v1:resource-table:v1:table-v6:routes', JSON.stringify([{ name: 'Legacy view', snapshot: { search: { q: 'Catalog', sort_by: 'name', sort_order: 'desc', page_size: 10, column_filters: {} }, presentation: { density: 'small', columns: ['raw', 'name', 'host', 'uri'] } } }]));
  });
  await page.goto('routes');
  await page.getByRole('combobox', { name: 'Saved views', exact: true }).click();
  await page.getByRole('option', { name: 'Legacy view', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toHaveValue('Catalog');
  await expect(page.getByRole('columnheader', { name: 'Host', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Target', exact: true })).toHaveCount(0);
  await expect(page.locator('.ant-table-small')).toBeVisible();
  await expect(page.getByText('Modified', { exact: true })).toHaveCount(0);
});

test('invalid widths and pins recover while unknown or duplicate column keys cannot displace RAW', async ({ page }) => {
  await mockAdmin(page);
  await page.addInitScript(() => {
    localStorage.setItem('resource-table:v1:table-v6:routes', JSON.stringify({ density: 'small', columns: ['host', 'uri'], order: ['host', 'host', 'missing', 'raw', 'name'], widths: { uri: -100 }, pins: { host: 'invalid' } }));
  });
  await page.goto('routes');
  await expect(page.getByRole('columnheader', { name: 'RAW', exact: true })).toBeVisible();
  const headers = await page.getByRole('columnheader').allTextContents();
  expect(headers.indexOf('Name')).toBe(headers.indexOf('RAW') + 1);
  await expect(page.getByRole('columnheader', { name: 'Host', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Table view settings' });
  await expect(settings.getByRole('spinbutton', { name: 'URI width', exact: true })).toHaveValue('200');
  await expect(settings.getByRole('button', { name: 'Move RAW later', exact: true })).toBeDisabled();
  await expect(settings.getByRole('checkbox', { name: 'Name', exact: true })).toBeDisabled();
});

test('saved pins release on narrow tables and return on resize while settings remain usable', async ({ page }, testInfo) => {
  const { writes } = await mockAdmin(page);
  await page.addInitScript(() => {
    localStorage.setItem('resource-table:v1:table-v6:routes', JSON.stringify({ density: 'middle', pins: { uri: 'left', status: 'right' }, widths: { uri: 260 } }));
  });
  await page.goto('routes');
  await expect(page.getByRole('columnheader', { name: 'URI', exact: true })).toHaveClass(/ant-table-cell-fix-start/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('columnheader', { name: 'URI', exact: true })).not.toHaveClass(/ant-table-cell-fix-start/);
  await expect(page.getByRole('columnheader', { name: 'RAW', exact: true })).toHaveClass(/ant-table-cell-fix-start/);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Table view settings' });
  await expect(settings).toBeVisible();
  await expect.poll(async () => { const bounds = await settings.boundingBox(); return Boolean(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 832); }).toBe(true);
  await expect(settings.getByText('Your pins are saved and will return when this table has more room.')).toBeAttached();
  await page.screenshot({ path: testInfo.outputPath('table-layout-narrow.png') });
  await settings.getByRole('spinbutton', { name: 'URI width', exact: true }).fill('300');
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.getByRole('columnheader', { name: 'URI', exact: true })).toHaveClass(/ant-table-cell-fix-start/);
  expect(writes).toEqual([]);
});
