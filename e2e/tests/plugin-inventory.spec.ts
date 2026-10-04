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
import { uiFillMonacoEditor } from '@e2e/utils/ui';
import { expect, type Page, test } from '@playwright/test';

import { comparablePluginJson, pluginInstances, type PluginSource, summarizePlugins } from '@/utils/pluginInventory';

const limit = { count: 10, time_window: 60, key: 'remote_addr', policy: 'local' };
const fixture = () => ({
  routes: [{ id: 'one', name: 'First API', uri: '/one', plugins: { 'limit-count': limit } }, { id: 'two', name: 'Second API', uri: '/two', plugins: { 'limit-count': { policy: 'local', key: 'remote_addr', time_window: 60, count: 10 } } }],
  services: [{ id: 'service', name: 'Shared service', plugins: { 'limit-count': { ...limit, count: 20 } } }],
  global_rules: [{ id: 'global', plugins: { 'limit-count': { ...limit, _meta: { disable: true } } } }],
  consumers: [{ username: 'alice', plugins: { 'key-auth': { key: 'fixture-only-key' } } }],
  'consumers/alice/credentials': [{ id: 'alice/credentials/token', plugins: { 'jwt-auth': { key: 'fixture-token-key' } } }],
});

test('inventory preserves own plugin keys and compares semantic objects while retaining array order', () => {
  const value = JSON.parse('{"id":"r","plugins":{"__proto__":{"constructor":1},"custom":{"arr":[1,2],"a":1}}}') as Record<string, unknown>;
  const sources: PluginSource[] = [
    { api: '/routes/r', scope: 'routes', id: 'r', name: 'r', value },
    { api: '/services/s', scope: 'services', id: 's', name: 's', value: { plugins: { custom: { a: 1, arr: [1, 2] } } } },
    { api: '/global_rules/g', scope: 'global_rules', id: 'g', name: 'g', value: { plugins: { custom: { a: 1, arr: [2, 1] } } } },
  ];
  const rows = pluginInstances(sources);
  expect(rows.map((row) => row.plugin)).toContain('__proto__');
  expect(summarizePlugins(rows).find((row) => row.plugin === 'custom')).toEqual({ plugin: 'custom', instances: 3, disabled: 0, variants: 2 });
  expect(JSON.stringify(comparablePluginJson(value))).toContain('"__proto__":{"constructor":1}');
  expect(() => pluginInstances([{ ...sources[0], value: { plugins: ['invalid'] } }])).toThrow('Invalid plugins object');
});

async function setup(page: Page, options: { many?: boolean; broken?: string; mismatch?: boolean; invalid?: 'duplicates' | 'plugins' | 'total' } = {}) {
  const store: Record<string, Array<Record<string, unknown>>> = fixture();
  if (options.many) store.routes = Array.from({ length: 101 }, (_, index) => ({ id: `route-${index}`, uri: `/route-${index}`, plugins: { 'limit-count': limit } }));
  if (options.invalid === 'duplicates') store.routes = [store.routes[0], store.routes[0]];
  if (options.invalid === 'plugins') store.routes[0].plugins = ['bad'];
  for (const items of Object.values(store)) for (const item of items) Object.assign(item, { create_time: 1, update_time: 2 });
  const writes: string[] = []; const reads: string[] = []; const state = { broken: options.broken ?? '', mismatch: options.mismatch ?? false };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = decodeURIComponent(url.pathname.replace('/apisix/admin/', ''));
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} /${path}`);
      const kind = path.split('/').slice(0, -1).join('/'); const id = path.split('/').at(-1);
      const value = store[kind]?.find((item) => item.id === id);
      if (request.method() === 'PATCH' && value) { Object.assign(value, request.postDataJSON()); return route.fulfill({ json: { value } }); }
      return route.fulfill({ status: 500, json: {} });
    }
    reads.push(path + url.search);
    if (path === 'plugins/list') return route.fulfill({ json: ['limit-count', 'key-auth', 'jwt-auth'] });
    if (path === state.broken) return route.fulfill({ status: 503, json: { error_msg: 'Fixture read failure' } });
    if (Object.hasOwn(store, path)) {
      const list = store[path]; const pageIndex = Number(url.searchParams.get('page') ?? 1); const pageSize = Number(url.searchParams.get('page_size') ?? 100);
      return route.fulfill({ json: { total: list.length + (options.invalid === 'total' && pageIndex > 1 ? 1 : 0), list: list.slice((pageIndex - 1) * pageSize, pageIndex * pageSize).map((value) => ({ value, ...(state.mismatch && path === 'services' ? { key: '/apisix/services/wrong' } : {}) })) } });
    }
    const kind = path.split('/').slice(0, -1).join('/'); const id = path.split('/').at(-1);
    const value = store[kind]?.find((item) => item.id === id || item.username === id || item.id === `${kind.replace('consumers/', '')}/${id}`);
    if (value) return route.fulfill({ json: { value } });
    return route.fulfill({ json: { total: 0, list: [] } });
  });
  await page.goto('plugin_inventory');
  await expect(page.getByRole('status')).toContainText('plugin names');
  return { writes, reads, state, store };
}

async function selectRoute(page: Page, name: string) {
  await page.getByRole('row').filter({ hasText: name }).getByRole('checkbox').check();
}

test('inventory scans configured resources and credentials, compares variants without writes', async ({ page }, info) => {
  const { writes } = await setup(page);
  await expect(page.getByRole('status')).toContainText('3 plugin names / 6 instances / 6 source resources');
  await expect(page.getByText('Disabled by _meta', { exact: true })).toBeVisible();
  await selectRoute(page, 'First API'); await selectRoute(page, 'Shared service');
  await page.getByRole('button', { name: 'Compare selected plugin values' }).click();
  const dialog = page.getByRole('dialog', { name: 'Compare limit-count', exact: true });
  await expect(dialog).toContainText('Left: /routes/one');
  await expect(dialog).toContainText('Right: /services/service');
  await dialog.getByRole('button', { name: 'Back to inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('plugin-inventory.png'), animations: 'disabled' });
  expect(writes).toEqual([]);
});

test('selected same-kind resources open existing bulk editor and verify one explicit patch each', async ({ page }) => {
  const { writes, store } = await setup(page);
  await selectRoute(page, 'First API'); await selectRoute(page, 'Second API');
  await page.getByRole('button', { name: 'Edit RAW', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Bulk RAW edit', exact: true });
  await expect(dialog).toContainText('2 selected resources');
  await uiFillMonacoEditor(page, dialog.locator('.monaco-editor'), '{"labels":{"env":"reviewed"}}');
  await dialog.getByRole('button', { name: 'Preview changes', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('2 ready');
  expect(writes).toEqual([]);
  await dialog.getByRole('button', { name: 'Apply 2 changes', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('2 saved and verified');
  expect(writes).toEqual(['PATCH /routes/one', 'PATCH /routes/two']);
  expect(store.routes.every((value) => (value.labels as Record<string, string>).env === 'reviewed')).toBe(true);
});

test('filter changes clear selection and credentials stay individually editable', async ({ page }) => {
  const { writes } = await setup(page);
  await selectRoute(page, 'First API');
  await page.getByRole('textbox', { name: 'Search plugin inventory' }).fill('jwt-auth');
  await expect(page.getByText('0 selected / 1 matching', { exact: true })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: '/consumers/alice/credentials/token' });
  await row.getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'Edit RAW', exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'Open RAW /consumers/alice/credentials/token', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /jwt-auth source: alice/ })).toBeVisible();
  expect(writes).toEqual([]);
});

test('partial or wrong-identity collections stay explicit and refresh recovers', async ({ page }) => {
  const { state, writes } = await setup(page, { broken: 'global_rules', mismatch: true });
  await expect(page.getByText('Partial inventory — some sources could not be read', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Partial');
  await expect(page.getByText(/Admin API resource identity could not be verified/)).toBeVisible();
  await selectRoute(page, 'First API');
  await expect(page.getByRole('button', { name: 'Edit RAW', exact: true })).toBeDisabled();
  state.broken = ''; state.mismatch = false;
  await page.getByRole('button', { name: 'Refresh plugin inventory', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('6 instances');
  await expect(page.getByText('Partial inventory — some sources could not be read', { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('inventory reads later pages instead of counting only the first page', async ({ page }) => {
  const { reads, writes } = await setup(page, { many: true });
  await expect(page.getByRole('status')).toContainText('105 instances');
  expect(reads).toContain('routes?page=2&page_size=100');
  await page.getByRole('textbox', { name: 'Search plugin inventory' }).fill('route-100');
  await expect(page.getByText('/routes/route-100', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('narrow inventory retains filters, row selection and RAW actions without page overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole('textbox', { name: 'Search plugin inventory' }).fill('First');
  const row = page.getByRole('row').filter({ hasText: '/routes/one' });
  await row.getByRole('checkbox').check();
  await row.getByRole('button', { name: 'Open RAW /routes/one', exact: true }).scrollIntoViewIfNeeded();
  await expect(row.getByRole('button', { name: 'Open RAW /routes/one', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('plugin-inventory-narrow.png'), animations: 'disabled' });
});

for (const invalid of ['duplicates', 'plugins', 'total'] as const) test(`invalid ${invalid} collection is never reported as complete`, async ({ page }) => {
  const { writes } = await setup(page, { invalid, many: invalid === 'total' });
  await expect(page.getByRole('status')).toContainText('Partial');
  await expect(page.getByRole('status')).toContainText('4 instances');
  await expect(page.getByText('Partial inventory — some sources could not be read', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});
