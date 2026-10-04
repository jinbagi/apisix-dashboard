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

const modal = (page: Page) => page.getByRole('dialog', { name: 'Clone with dependencies', exact: true });
async function setup(page: Page, kind = 'routes', simple = false) {
  const records = new Map<string, Record<string, unknown>>([
    ['/routes/main', { id: 'main', name: 'Checkout', uri: '/checkout/*', status: 1, ...(simple ? {} : { service_id: 'svc', plugin_config_id: 'common' }), future: { order: [2, 1] } }],
    ['/stream_routes/stream', { id: 'stream', name: 'Stream source', server_port: 9100, upstream_id: 'backend' }],
    ['/services/svc', { id: 'svc', name: 'Checkout service', upstream_id: 'backend' }],
    ['/upstreams/backend', { id: 'backend', nodes: { '127.0.0.1:1980': 1 } }],
    ['/plugin_configs/common', { id: 'common', plugins: { 'grpc-transcode': { proto_id: 'proto', service: 'Hello', method: 'Say' }, 'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 'backend', weight: 1 }] }] } } }],
    ['/protos/proto', { id: 'proto', content: 'syntax = "proto3"; message Hello {}' }],
    ['/services/svc/graphql_cost_decorations/cost', { id: 'cost', type_name: 'Query', field: 'checkout', cost: 1 }],
  ]);
  const controls = { records, writes: [] as { url: string; body: Record<string, unknown> }[], fail: new Set<string>(), gates: new Map<string, Promise<void>>() };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('clone-fixture-only')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = decodeURIComponent(url.pathname.replace('/apisix/admin', ''));
    const gated = controls.gates.has(path);
    const captured = structuredClone(records.get(path));
    if (gated) await controls.gates.get(path);
    if (controls.fail.has(path)) return route.fulfill({ status: 503, json: { error_msg: 'Fixture unavailable' } });
    if (request.method() !== 'GET') {
      const body = request.postDataJSON() as Record<string, unknown>; controls.writes.push({ url: path, body });
      records.set(path, { ...body, id: path.split('/').at(-1) });
      return route.fulfill({ json: { value: records.get(path), key: `/apisix${path}` } });
    }
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 1 || (parts.length === 3 && parts[2] === 'graphql_cost_decorations')) {
      const matching = [...records.entries()].filter(([key]) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1);
      const size = Number(url.searchParams.get('page_size') ?? 100); const start = (Number(url.searchParams.get('page') ?? 1) - 1) * size;
      return route.fulfill({ json: { list: matching.slice(start, start + size).map(([key, value]) => ({ value, key: `/apisix${key}` })), total: matching.length } });
    }
    const value = gated ? captured : records.get(path);
    return value ? route.fulfill({ json: { value, key: `/apisix${path}` } }) : route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
  });
  await page.goto(kind); return controls;
}
async function open(page: Page) {
  await page.getByRole('checkbox', { name: 'Select row', exact: true }).first().check();
  await page.getByRole('region', { name: 'Selected resource actions' }).getByRole('button', { name: 'Clone with dependencies', exact: true }).click();
}
async function stage(page: Page, count: number) {
  await expect(modal(page).getByRole('status')).toHaveText(`${count} resources · 0 blocked destinations`);
  await modal(page).getByRole('checkbox', { name: /I reviewed the destination IDs/ }).check();
  await modal(page).getByRole('button', { name: 'Stage clone', exact: true }).click();
  await expect(modal(page)).toContainText(`${count} resources staged; nothing applied yet`);
}
async function workspace(page: Page) {
  await modal(page).getByRole('button', { name: 'Close clone', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Change sets', exact: true }).click();
}
async function apply(page: Page, count: number) {
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click();
  await page.getByRole('button', { name: `Apply ${count} changes`, exact: true }).click();
  await page.getByRole('dialog', { name: 'Apply change set', exact: true }).getByRole('button', { name: `Apply ${count} changes`, exact: true }).click();
  await expect(page.getByText(`${count} staged · ${count} verified`, { exact: true })).toBeVisible();
}

test('reviews a whole supported bundle and stages create-only drafts before ordered verified application', async ({ page }) => {
  const controls = await setup(page); const original = JSON.stringify([...controls.records]); await open(page);
  await expect(modal(page).getByRole('status')).toHaveText('6 resources · 0 blocked destinations');
  await modal(page).getByRole('button', { name: 'Review JSON: main-copy', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review clone JSON', exact: true })).toContainText('/routes/main → /routes/main-copy');
  await page.getByRole('dialog', { name: 'Review clone JSON', exact: true }).getByRole('button', { name: 'Done reviewing', exact: true }).click();
  await modal(page).getByText('Destination IDs', { exact: true }).click();
  await expect(modal(page).getByLabel('Destination routes/main', { exact: true })).toBeHidden();
  await modal(page).locator('.ant-modal-body').evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: test.info().outputPath('dependency-clone.png'), animations: 'disabled' });
  await stage(page, 6); expect(controls.writes).toEqual([]); expect(JSON.stringify([...controls.records])).toBe(original);
  await workspace(page); await expect(page.getByText('Create only', { exact: true })).toHaveCount(6);
  await apply(page, 6);
  const urls = controls.writes.map((write) => write.url);
  expect(urls.indexOf('/upstreams/backend-copy')).toBeLessThan(urls.indexOf('/services/svc-copy'));
  expect(urls.indexOf('/protos/proto-copy')).toBeLessThan(urls.indexOf('/plugin_configs/common-copy'));
  expect(urls.indexOf('/services/svc-copy')).toBeLessThan(urls.indexOf('/services/svc-copy/graphql_cost_decorations/cost'));
  expect(urls.indexOf('/plugin_configs/common-copy')).toBeLessThan(urls.indexOf('/routes/main-copy'));
  expect(controls.records.get('/routes/main-copy')).toMatchObject({ status: 0, service_id: 'svc-copy', plugin_config_id: 'common-copy', future: { order: [2, 1] } });
  expect(controls.records.get('/routes/main')).toMatchObject({ status: 1, service_id: 'svc' });
});

test('HTTP activation requires an explicit choice and invalidates the prior review', async ({ page }) => {
  const controls = await setup(page, 'routes', true); await open(page);
  await expect(modal(page).getByRole('status')).toHaveText('1 resources · 0 blocked destinations');
  await modal(page).getByRole('checkbox', { name: /Enable cloned HTTP Routes/ }).check();
  await expect(modal(page).getByRole('button', { name: 'Stage clone', exact: true })).toBeDisabled();
  await modal(page).getByRole('button', { name: 'Check destinations', exact: true }).click();
  await stage(page, 1); await workspace(page); await apply(page, 1);
  expect(controls.records.get('/routes/main-copy')?.status).toBe(1);
});

test('existing and original IDs are blocked and keyboard mapping repair invalidates the previous preview', async ({ page }) => {
  const controls = await setup(page, 'routes', true);
  controls.records.set('/routes/main-copy', { id: 'main-copy', uri: '/someone-else' });
  await open(page); await expect(modal(page)).toContainText('Destination already exists');
  await modal(page).getByLabel('Destination routes/main', { exact: true }).fill('main');
  await modal(page).getByRole('button', { name: 'Check destinations', exact: true }).click();
  await expect(modal(page)).toContainText('Choose a new destination ID');
  const input = modal(page).getByLabel('Destination routes/main', { exact: true });
  await input.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('manual-clone');
  await expect(modal(page).getByRole('button', { name: 'Stage clone', exact: true })).toBeDisabled();
  await modal(page).getByRole('button', { name: 'Check destinations', exact: true }).click(); await stage(page, 1);
  expect(controls.writes).toEqual([]);
});

test('destination creation after preview blocks staging, and later creation blocks Change sets application', async ({ page }) => {
  const controls = await setup(page, 'routes', true); await open(page);
  await expect(modal(page).getByRole('status')).toHaveText('1 resources · 0 blocked destinations');
  controls.records.set('/routes/main-copy', { id: 'main-copy', uri: '/raced' });
  await modal(page).getByRole('checkbox', { name: /I reviewed the destination IDs/ }).check();
  await modal(page).getByRole('button', { name: 'Stage clone', exact: true }).click();
  await expect(modal(page)).toContainText('A destination or reference changed');
  controls.records.delete('/routes/main-copy');
  await modal(page).getByRole('button', { name: 'Check destinations', exact: true }).click(); await stage(page, 1);
  controls.records.set('/routes/main-copy', { id: 'main-copy', uri: '/raced-after-stage' });
  await workspace(page); await page.getByRole('button', { name: 'Preview destinations', exact: true }).click();
  await expect(page.getByText(/The destination changed since this draft was staged/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Apply.*changes$/ })).toBeDisabled(); expect(controls.writes).toEqual([]);
});

test('source read failure blocks the complete clone and retry reloads source data', async ({ page }) => {
  const controls = await setup(page); controls.fail.add('/protos/proto'); await open(page);
  await expect(modal(page)).toContainText('Clone needs attention');
  await expect(modal(page).getByRole('button', { name: 'Stage clone', exact: true })).toBeDisabled();
  controls.fail.clear(); await modal(page).getByRole('button', { name: 'Reload source and reset clone', exact: true }).click();
  await stage(page, 6); expect(controls.writes).toEqual([]);
});

test('closing and reopening ignores the old delayed source read', async ({ page }) => {
  const controls = await setup(page, 'routes', true); let release!: () => void;
  controls.gates.set('/routes/main', new Promise<void>((resolve) => { release = resolve; }));
  await open(page); await modal(page).getByRole('button', { name: 'Close clone', exact: true }).click();
  controls.gates.clear(); controls.records.set('/routes/main', { id: 'main', uri: '/fresh', service_id: 'svc' });
  await page.getByRole('button', { name: 'Clone with dependencies', exact: true }).click();
  await expect(modal(page).getByRole('status')).toHaveText('4 resources · 0 blocked destinations');
  release();
  // All Admin reads are mocked; wait for the released stale read and any resulting preview to settle.
  // eslint-disable-next-line playwright/no-networkidle
  await page.waitForLoadState('networkidle');
  await expect(modal(page).getByRole('status')).toHaveText('4 resources · 0 blocked destinations');
  await stage(page, 4); expect(controls.writes).toEqual([]);
});

test('the full clone cannot silently replace an already staged destination', async ({ page }) => {
  const controls = await setup(page, 'routes', true); await open(page); await stage(page, 1);
  await modal(page).getByRole('button', { name: 'Close clone', exact: true }).click();
  await page.getByRole('button', { name: 'Clone with dependencies', exact: true }).click();
  await expect(modal(page).getByRole('status')).toHaveText('1 resources · 0 blocked destinations');
  await modal(page).getByRole('checkbox', { name: /I reviewed the destination IDs/ }).check();
  await modal(page).getByRole('button', { name: 'Stage clone', exact: true }).click();
  await expect(modal(page)).toContainText('is already staged');
  await workspace(page); await expect(page.getByText('1 staged · 0 verified', { exact: true })).toBeVisible(); expect(controls.writes).toEqual([]);
});

test('Stream Route clones retain matching fields and require scope review without inventing disabled status', async ({ page }) => {
  const controls = await setup(page, 'stream_routes'); await open(page);
  await expect(modal(page)).toContainText('Review Stream Route matching');
  await expect(modal(page).getByRole('checkbox', { name: /Enable cloned HTTP Routes/ })).toHaveCount(0);
  await expect(modal(page).getByRole('button', { name: 'Stage clone', exact: true })).toBeDisabled();
  await stage(page, 2); await workspace(page); await apply(page, 2);
  expect(controls.records.get('/stream_routes/stream-copy')).toMatchObject({ server_port: 9100, upstream_id: 'backend-copy' });
  expect(controls.records.get('/stream_routes/stream-copy')).not.toHaveProperty('status');
});

for (const height of [844, 640]) test(`narrow clone footer stays reachable with production fonts at 390x${height}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height }); await setup(page); await open(page);
  await expect(modal(page).getByRole('status')).toHaveText('6 resources · 0 blocked destinations');
  await page.evaluate(() => document.fonts.ready);
  const footer = await modal(page).getByRole('button', { name: 'Stage clone', exact: true }).boundingBox();
  expect(footer!.y).toBeGreaterThan(0); expect(footer!.y + footer!.height).toBeLessThanOrEqual(height);
  expect(await modal(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await modal(page).getByLabel('Destination upstreams/backend', { exact: true }).focus();
  await page.keyboard.press('Tab');
  expect(await modal(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`dependency-clone-narrow-${height}.png`), animations: 'disabled' });
});


test('leaving the source page while staging is waiting cannot add background drafts', async ({ page }) => {
  const controls = await setup(page, 'routes', true);
  await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Routes', exact: true }).click();
  await open(page); await expect(modal(page).getByRole('status')).toHaveText('1 resources · 0 blocked destinations');
  let release!: () => void;
  controls.gates.set('/routes/main-copy', new Promise<void>((resolve) => { release = resolve; }));
  await modal(page).getByRole('checkbox', { name: /I reviewed the destination IDs/ }).check();
  await modal(page).getByRole('button', { name: 'Stage clone', exact: true }).click();
  await expect(modal(page).getByRole('button', { name: 'Stage clone', exact: true })).toHaveAttribute('aria-busy', 'true');
  await page.goBack(); await expect(page).toHaveURL(/dashboard/);
  controls.gates.clear(); release();
  // All Admin reads are mocked; wait for any accidentally continued stage operation to settle.
  // eslint-disable-next-line playwright/no-networkidle
  await page.waitForLoadState('networkidle');
  await page.getByRole('menuitem', { name: 'Change sets', exact: true }).click();
  await expect(page.getByText('No staged changes yet', { exact: true })).toBeVisible(); expect(controls.writes).toEqual([]);
});
