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

import { type ConfigurationSource, resolvePlugins, resolveUpstream } from '@/utils/routeConfiguration';

async function setup(page: Page, overrides: Record<string, Record<string, unknown>> = {}) {
  const records = new Map(Object.entries({
    '/routes/explain': { id: 'explain', uri: '/explain', desc: 'Saved description', service_id: 'backend',
      plugin_config_id: 'common', plugins: { 'proxy-rewrite': { uri: '/route' } }, create_time: 1, update_time: 1 },
    '/services/backend': { id: 'backend', plugins: { 'proxy-rewrite': { uri: '/service', host: 'service.example' },
      'limit-count': { count: 10, time_window: 60, key: 'remote_addr', rejected_code: 429, policy: 'local' } }, upstream_id: 'pool', enable_websocket: true },
    '/plugin_configs/common': { id: 'common', plugins: { 'proxy-rewrite': { uri: '/config' },
      'limit-count': { count: 20, time_window: 60, key: 'remote_addr', rejected_code: 429, policy: 'local' } } },
    '/consumers/alice': { username: 'alice', group_id: 'premium', plugins: {
      'proxy-rewrite': { uri: '/consumer', headers: { set: { Authorization: 'private-consumer-token' } } },
      'key-auth': { key: 'private-auth-key' },
    } },
    '/consumer_groups/premium': { id: 'premium', plugins: {
      'proxy-rewrite': { uri: '/group', headers: { set: { Authorization: 'private-group-token' } } },
      'limit-count': { count: 100, time_window: 60, key: 'remote_addr', rejected_code: 429, policy: 'local' },
    } },
    '/upstreams/pool': { id: 'pool', type: 'roundrobin', nodes: { '127.0.0.1:8080': 1 } },
    ...overrides,
  }));
  const failures = new Set<string>();
  const writes: string[] = [];
  const reads: string[] = [];
  let globals = [{ id: 'global-one', plugins: { 'proxy-rewrite': { uri: '/global' } } }];
  let pagination: 'none' | 'complete' | 'short' | 'duplicate' | 'changing' = 'none';
  const delays = new Map<string, Promise<void>>();
  let consumerNames = ['alice'];
  let badConsumerTotal = false;
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/apisix/admin', '');
    if (request.method() !== 'GET') {
      writes.push(path);
      return route.fulfill({ status: 500, json: { error_msg: 'Explanation must not write' } });
    }
    reads.push(path + url.search);
    await delays.get(path);
    if (failures.has(path)) return route.fulfill({ status: 503, json: { error_msg: 'Fixture unavailable' } });
    let response: unknown = { list: [], total: 0 };
    if (records.has(path)) response = { value: records.get(path) };
    else if (path === '/global_rules') {
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      const first = pagination === 'none' || pagination === 'short' ? globals
        : [...globals, ...Array.from({ length: 99 }, (_, index) => ({ id: `global-empty-${index}`, plugins: {} }))];
      const values = pageNumber === 2 ? [{ id: pagination === 'duplicate' ? 'global-one' : 'global-two', plugins: { 'proxy-rewrite': { uri: '/second-global' } } }] : first;
      response = { list: values.map((value) => ({ value })), total: pagination === 'none' ? values.length : pagination === 'changing' && pageNumber === 2 ? 102 : 101 };
    } else if (path === '/consumers') {
      const offset = (Number(url.searchParams.get('page') ?? 1) - 1) * 100;
      response = { list: consumerNames.slice(offset, offset + 100).map((username) => ({ value: { username, plugins: { 'key-auth': { key: 'private-list-key' } } } })), total: consumerNames.length + (badConsumerTotal ? 1 : 0) };
    } else if (path === '/plugins/list') response = [];
    else if (path === '/services') response = { list: [{ value: records.get('/services/backend') }], total: 1 };
    else if (path === '/upstreams') response = { list: [{ value: records.get('/upstreams/pool') }], total: 1 };
    else if (path === '/plugin_configs') response = { list: [{ value: records.get('/plugin_configs/common') }], total: 1 };
    await route.fulfill({ json: response });
  });
  await page.goto('routes/detail/explain');
  await expect(page.getByRole('button', { name: 'Explain configuration', exact: true })).toBeVisible();
  return { records, failures, writes, reads,
    paginate: () => { pagination = 'complete'; },
    breakGlobalPages: (mode: 'short' | 'duplicate' | 'changing') => { pagination = mode; },
    setConsumerNames: (names: string[], invalid = false) => { consumerNames = names; badConsumerTotal = invalid; },
    delay: (path: string) => {
      let release!: () => void;
      delays.set(path, new Promise<void>((resolve) => { release = resolve; }));
      return () => { delays.delete(path); release(); };
    },
    clearGlobals: () => { globals = []; } };
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Route configuration sources', exact: true });
async function open(page: Page) {
  await page.getByRole('button', { name: 'Explain configuration', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function ready(page: Page) {
  await expect(dialog(page).getByRole('heading', { name: 'Local plugin precedence' })).toBeVisible();
}
const localTable = (page: Page) => dialog(page).getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Selected source', exact: true }) });
const globalTable = (page: Page) => dialog(page).getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Global source', exact: true }) });
const pluginRow = (page: Page, name: string) => localTable(page).getByRole('row').filter({ hasText: name });

test('explains whole-plugin precedence and keeps Global Rules separate', async ({ page }) => {
  const controls = await setup(page);
  await open(page);
  await ready(page);
  const proxy = pluginRow(page, 'proxy-rewrite');
  await expect(proxy.getByRole('cell').nth(1)).toHaveText('Route: explain');
  await expect(proxy.getByRole('cell').nth(3)).toContainText('Plugin Config: common');
  await expect(proxy.getByRole('cell').nth(3)).toContainText('Service: backend');
  await expect(pluginRow(page, 'limit-count').getByRole('cell').nth(1)).toHaveText('Plugin Config: common');
  await expect(globalTable(page)).toContainText('Global Rule: global-one');
  await expect(globalTable(page)).toContainText('proxy-rewrite');
  await expect(dialog(page).getByRole('link', { name: 'Upstream: pool' })).toHaveAttribute('href', /upstreams\/detail\/pool$/);
  await page.screenshot({ path: test.info().outputPath('configuration-sources.png'), animations: 'disabled' });
  await proxy.getByRole('button', { name: 'View JSON' }).click();
  const json = page.getByRole('dialog', { name: 'proxy-rewrite configuration', exact: true });
  const inspected = JSON.parse(await json.locator('pre').innerText());
  expect(inspected.selected.config).toEqual({ uri: '/route' });
  expect(inspected.overridden).toHaveLength(2);
  expect(controls.writes).toEqual([]);
});

test('disabled winners do not fall back and request filters are marked conditional', async ({ page }) => {
  const controls = await setup(page);
  controls.records.get('/routes/explain')!.plugins = {
    'proxy-rewrite': { _meta: { disable: true } },
    'limit-count': { _meta: { filter: [['arg_debug', '==', '1']] }, count: 5 },
  };
  await open(page);
  await ready(page);
  await expect(pluginRow(page, 'proxy-rewrite')).toContainText('Disabled');
  await expect(pluginRow(page, 'proxy-rewrite').getByRole('cell').nth(1)).toHaveText('Route: explain');
  await expect(pluginRow(page, 'limit-count')).toContainText('Conditional');
  await expect(dialog(page)).toContainText('Consumer and Consumer Group');
  expect(controls.writes).toEqual([]);
});

test('script inheritance and an explicit Route WebSocket false are explained', async ({ page }) => {
  const controls = await setup(page);
  controls.records.get('/services/backend')!.script = 'return {}';
  controls.records.get('/routes/explain')!.enable_websocket = false;
  await open(page);
  await ready(page);
  await expect(dialog(page).getByText('Script configuration detected')).toBeVisible();
  await expect(localTable(page)).toContainText('Script bypass');
  const websocket = dialog(page).getByRole('row').filter({ hasText: 'WebSocket' });
  await expect(websocket).toContainText('Disabled');
  await expect(websocket).toContainText('Route: explain');
});

test('Route inline upstream replaces an inherited Service upstream ID', async ({ page }) => {
  const controls = await setup(page);
  controls.records.get('/routes/explain')!.upstream = { nodes: { '127.0.0.1:9090': 1 } };
  await open(page);
  await ready(page);
  const row = dialog(page).getByRole('row').filter({ hasText: 'Configured upstream' });
  await expect(row).toContainText('Inline upstream');
  await expect(row).toContainText('Route: explain');
  await expect(row).not.toContainText('Upstream: pool');
});

test('reads all Global Rule pages without merging duplicate plugin names', async ({ page }) => {
  const controls = await setup(page);
  controls.paginate();
  await open(page);
  await ready(page);
  await expect(globalTable(page).getByText('proxy-rewrite', { exact: true })).toHaveCount(2);
  expect(controls.reads.some((url) => url.includes('global_rules?page=2'))).toBe(true);
});

for (const path of ['/services/backend', '/plugin_configs/common', '/upstreams/pool', '/global_rules']) {
  test(`unavailable ${path} prevents a misleading complete explanation and can retry`, async ({ page }) => {
    const controls = await setup(page);
    controls.failures.add(path);
    await open(page);
    await expect(dialog(page).getByText('Configuration could not be explained')).toBeVisible();
    await expect(dialog(page).getByRole('table')).toHaveCount(0);
    controls.failures.clear();
    await dialog(page).getByRole('button', { name: 'Refresh sources' }).click();
    await ready(page);
    expect(controls.writes).toEqual([]);
  });
}

test('fresh reads and refresh preserve unsaved form edits', async ({ page }) => {
  const controls = await setup(page);
  await page.getByLabel('Description', { exact: true }).fill('Unsaved form edit');
  controls.records.get('/routes/explain')!.plugins = { 'proxy-rewrite': { uri: '/new-saved-value' } };
  await open(page);
  await ready(page);
  await pluginRow(page, 'proxy-rewrite').getByRole('button', { name: 'View JSON' }).click();
  await expect(page.getByRole('dialog', { name: 'proxy-rewrite configuration', exact: true })).toContainText('/new-saved-value');
  await page.getByRole('button', { name: 'Close JSON' }).click();
  await dialog(page).getByRole('button', { name: 'Refresh sources' }).click();
  await ready(page);
  await dialog(page).getByRole('button', { name: 'Close explanation' }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Unsaved form edit');
  expect(controls.writes).toEqual([]);
});

test('explanation does not replace a RAW draft and fits a narrow viewport', async ({ page }) => {
  const controls = await setup(page);
  await page.getByRole('tab', { name: 'Admin API JSON', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Admin API JSON' }).locator('.monaco-editor').first()).toBeVisible();
  await page.evaluate(() => window.__monacoEditor__?.setValue('{"uri":"/draft-only"}'));
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await ready(page);
  const box = await dialog(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  await dialog(page).getByRole('button', { name: 'Close explanation' }).click();
  expect(await page.evaluate(() => window.__monacoEditor__?.getValue())).toBe('{"uri":"/draft-only"}');
  expect(controls.writes).toEqual([]);
});

test('unlinked routes explain empty local and global configurations', async ({ page }) => {
  const controls = await setup(page, { '/routes/explain': { id: 'explain', uri: '/empty', create_time: 1, update_time: 1 } });
  controls.clearGlobals();
  await open(page);
  await ready(page);
  await expect(dialog(page).getByText('No local plugins configured')).toBeVisible();
  await expect(dialog(page).getByText('No Global Rule plugins configured')).toBeVisible();
  await expect(dialog(page)).toContainText('No upstream configured');
});

test('upstream selection follows APISIX Route and Service precedence without mutating inputs', () => {
  const service: ConfigurationSource = { kind: 'services', id: 's', value: { upstream: { nodes: { service: 1 } }, upstream_id: 'service-id' } };
  const route: ConfigurationSource = { kind: 'routes', id: 'r', value: {} };
  expect(resolveUpstream(route, service)?.id).toBe('service-id');
  route.value.upstream = { nodes: { inline: 1 } };
  expect(resolveUpstream(route, service)).toEqual({ source: route, id: undefined, value: route.value.upstream });
  route.value.upstream_id = 'route-id';
  expect(resolveUpstream(route, service)?.id).toBe('route-id');
  expect(service.value.upstream_id).toBe('service-id');
  const sources: ConfigurationSource[] = [
    { ...route, value: { plugins: { example: { a: 1, _meta: { disable: true } } } } },
    { ...service, value: { plugins: { example: { b: 2 } } } },
  ];
  expect(resolvePlugins(sources)[0].value).toEqual({ a: 1, _meta: { disable: true } });
  expect(sources[1].value.plugins).toEqual({ example: { b: 2 } });
});


async function chooseConsumer(page: Page, username: string) {
  await dialog(page).getByLabel('Consumer username', { exact: true }).fill(username);
  await dialog(page).getByRole('button', { name: 'Explain Consumer', exact: true }).click();
}

test('Consumer and linked Group override local plugins as whole objects without exposing private settings', async ({ page }) => {
  const controls = await setup(page);
  await open(page); await ready(page);
  await chooseConsumer(page, 'alice');
  await expect(pluginRow(page, 'proxy-rewrite').getByRole('cell').nth(1)).toHaveText('Consumer: alice');
  await expect(pluginRow(page, 'proxy-rewrite').getByRole('cell').nth(3)).toContainText('Consumer Group: premium');
  await expect(pluginRow(page, 'limit-count').getByRole('cell').nth(1)).toHaveText('Consumer Group: premium');
  await expect(globalTable(page)).toContainText('Global Rule: global-one');
  await expect(dialog(page).getByRole('link', { name: 'Consumer: alice', exact: true }).first()).toHaveAttribute('href', /consumers\/detail\/alice$/);
  await pluginRow(page, 'proxy-rewrite').getByRole('button', { name: 'View JSON' }).click();
  const json = page.getByRole('dialog', { name: 'proxy-rewrite configuration', exact: true });
  await expect(json).toContainText('Hidden in this explanation');
  await expect(json).not.toContainText('private-consumer-token');
  await expect(json).not.toContainText('private-group-token');
  await expect(json).toContainText('/route');
  await page.getByRole('button', { name: 'Close JSON' }).click();
  await pluginRow(page, 'key-auth').getByRole('button', { name: 'View JSON' }).click();
  await expect(page.getByRole('dialog', { name: 'key-auth configuration', exact: true })).not.toContainText('private-auth-key');
  await page.getByRole('button', { name: 'Close JSON' }).click();
  expect(controls.reads.some((path) => path.includes('/credentials'))).toBe(false);
  expect(controls.writes).toEqual([]);
  await dialog(page).locator('.ant-modal-body').evaluate((body) => { body.scrollTop = 0; });
  await page.screenshot({ path: test.info().outputPath('consumer-configuration.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog(page).getByRole('button', { name: 'Close explanation' })).toBeInViewport();
  await dialog(page).locator('.ant-modal-body').evaluate((body) => { body.scrollTop = 0; });
  const consumerAction = await dialog(page).getByRole('button', { name: 'Explain Consumer', exact: true }).boundingBox();
  expect(consumerAction!.x + consumerAction!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('consumer-configuration-narrow.png'), animations: 'disabled' });
});

test('disabled Consumer winners and conditional Group settings keep their origins; clear restores local sources', async ({ page }) => {
  const controls = await setup(page);
  controls.records.get('/consumers/alice')!.plugins = { 'proxy-rewrite': { _meta: { disable: true } } };
  controls.records.get('/consumer_groups/premium')!.plugins = { 'limit-count': { count: 10, _meta: { filter: [['arg_plan', '==', 'premium']] } } };
  await open(page); await ready(page); await chooseConsumer(page, 'alice');
  await expect(pluginRow(page, 'proxy-rewrite')).toContainText('Disabled');
  await expect(pluginRow(page, 'proxy-rewrite').getByRole('cell').nth(1)).toHaveText('Consumer: alice');
  await expect(pluginRow(page, 'limit-count')).toContainText('Conditional');
  await dialog(page).getByRole('button', { name: 'Clear Consumer' }).click();
  await expect(pluginRow(page, 'proxy-rewrite').getByRole('cell').nth(1)).toHaveText('Route: explain');
  await expect(pluginRow(page, 'limit-count').getByRole('cell').nth(1)).toHaveText('Plugin Config: common');
});

test('unlinked Consumer usernames are encoded and do not cause a Group or credential lookup', async ({ page }) => {
  const controls = await setup(page, { '/consumers/team%2Falice': { username: 'team/alice', plugins: { 'proxy-rewrite': { uri: '/team' } } } });
  await open(page); await ready(page); await chooseConsumer(page, 'team/alice');
  await expect(pluginRow(page, 'proxy-rewrite').getByRole('cell').nth(1)).toHaveText('Consumer: team/alice');
  expect(controls.reads).toContain('/consumers/team%2Falice');
  expect(controls.reads.some((path) => path.startsWith('/consumer_groups/') || path.includes('/credentials'))).toBe(false);
});

for (const path of ['/consumers/alice', '/consumer_groups/premium']) {
  test(`unavailable ${path} blocks the Consumer explanation and refresh recovers`, async ({ page }) => {
    const controls = await setup(page);
    controls.failures.add(path);
    await open(page); await ready(page); await chooseConsumer(page, 'alice');
    await expect(dialog(page).getByText('Configuration could not be explained')).toBeVisible();
    await expect(dialog(page).getByRole('table')).toHaveCount(0);
    controls.failures.clear();
    await dialog(page).getByRole('button', { name: 'Refresh sources' }).click();
    await expect(pluginRow(page, 'proxy-rewrite').getByRole('cell').nth(1)).toHaveText('Consumer: alice');
  });
}

test('a late Consumer response cannot replace the cleared context or an unsaved form draft', async ({ page }) => {
  const controls = await setup(page);
  await page.getByLabel('Description', { exact: true }).fill('Preserve my draft');
  const release = controls.delay('/consumers/alice');
  await open(page); await ready(page); await chooseConsumer(page, 'alice');
  await expect.poll(() => controls.reads.includes('/consumers/alice')).toBe(true);
  await dialog(page).getByRole('button', { name: 'Clear Consumer' }).click();
  await expect(pluginRow(page, 'proxy-rewrite').getByRole('cell').nth(1)).toHaveText('Route: explain');
  const obsoleteResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/upstreams/pool'));
  release();
  await (await obsoleteResponse).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(pluginRow(page, 'proxy-rewrite').getByRole('cell').nth(1)).toHaveText('Route: explain');
  await dialog(page).getByRole('button', { name: 'Close explanation' }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Preserve my draft');
  expect(controls.writes).toEqual([]);
});

for (const mode of ['short', 'duplicate', 'changing'] as const) {
  test(`${mode} Global Rule pagination blocks a falsely complete explanation`, async ({ page }) => {
    const controls = await setup(page);
    controls.breakGlobalPages(mode);
    await open(page);
    await expect(dialog(page).getByText('Configuration could not be explained')).toBeVisible();
    await expect(dialog(page).getByRole('table')).toHaveCount(0);
    controls.paginate();
    await dialog(page).getByRole('button', { name: 'Refresh sources' }).click();
    await ready(page);
  });
}

test('mismatched Consumer identity is rejected before using its group or plugins', async ({ page }) => {
  const controls = await setup(page);
  controls.records.get('/consumers/alice')!.username = 'someone-else';
  await open(page); await ready(page); await chooseConsumer(page, 'alice');
  await expect(dialog(page)).toContainText('did not return the requested resource identity');
  await expect(dialog(page).getByRole('table')).toHaveCount(0);
  expect(controls.reads).not.toContain('/consumer_groups/premium');
});

test('Consumer suggestions read every page and incomplete suggestions still allow an exact username', async ({ page }) => {
  const controls = await setup(page);
  controls.setConsumerNames([...Array.from({ length: 100 }, (_, index) => `user-${index}`), 'alice']);
  await open(page); await ready(page);
  await dialog(page).getByLabel('Consumer username', { exact: true }).fill('alice');
  await expect(page.locator('.ant-select-item-option-content').getByText('alice', { exact: true })).toBeVisible();
  expect(controls.reads).toContain('/consumers?page=2&page_size=100');
  await page.keyboard.press('Escape');
  controls.setConsumerNames(['alice'], true);
  await page.reload();
  await open(page); await ready(page);
  await dialog(page).getByLabel('Consumer username', { exact: true }).fill('alice');
  await expect(dialog(page).getByText('Consumer suggestions unavailable')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Explain Consumer', exact: true }).click();
  await expect(pluginRow(page, 'proxy-rewrite').getByRole('cell').nth(1)).toHaveText('Consumer: alice');
  await expect(dialog(page)).not.toContainText('private-list-key');
});
