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
  options: { empty?: boolean; failSearchPage?: boolean } = {},
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
      const list = options.empty
        ? []
        : resources.filter(
            (row) => !label || label === `env:${row.labels.env}`,
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
  test(`${title} uses the shared table controls and puts identity before RAW`, async ({
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
    expect(headers.indexOf(primary)).toBeLessThan(headers.indexOf('RAW'));
    expect(headers.at(-1)).toBe('RAW');
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
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
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
  const scroller = page.getByRole('region', { name: /^Routes columns/ });
  await expect(scroller).toHaveAttribute('tabindex', '0');
  await scroller.focus();
  await scroller.press('ArrowRight');
  await expect
    .poll(() => scroller.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
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
  await expect(filters).toContainText('Status: Enabled (loaded rows)');
  await filters.getByRole('button', { name: 'Clear filters' }).click();
  await expect(
    page.getByRole('link', { name: 'Catalog route 03', exact: true }),
  ).toBeVisible();
});
