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

function applyFixturePatch(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete target[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const previous = target[key];
      const nested = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as Record<string, unknown> : {};
      applyFixturePatch(nested, value as Record<string, unknown>);
      target[key] = nested;
    } else target[key] = value;
  }
}

async function setup(page: Page, screen = 'dashboard') {
  const controls = {
    failed: new Set<string>(), badTotal: false, reads: [] as string[], writes: [] as unknown[],
    data: {
      routes: [{ id: 'http', uri: '/test', service_id: 'broken' }, { id: 'plugin', uri: '/plugin', plugin_config_id: 'missing' }],
      stream_routes: [{ id: 'tcp', server_port: 9000, service_id: 'broken' }],
      services: [{ id: 'broken', name: 'Broken service', upstream_id: 'gone', create_time: 1, update_time: 1 },
        ...Array.from({ length: 100 }, (_, i) => ({ id: `service-${i}`, upstream_id: 'good', create_time: 1, update_time: 1 }))],
      upstreams: [{ id: 'good', nodes: { '127.0.0.1:80': 1 }, type: 'roundrobin' }],
      plugin_configs: [], consumers: [{ username: 'alice', group_id: 'missing-group' }], consumer_groups: [], global_rules: [], protos: [],
    } as Record<string, Record<string, unknown>[]>,
  };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/apisix/admin/', '');
    controls.reads.push(path + url.search);
    const [kind, id] = path.split('/');
    if (controls.failed.has(kind)) return route.fulfill({ status: 503, json: { error_msg: 'Unavailable' } });
    if (path === 'plugins/list') return route.fulfill({ json: [] });
    const values = controls.data[kind] ?? [];
    if (id) {
      const item = values.find((value) => value.id === id);
      if (route.request().method() === 'PATCH') {
        controls.writes.push(route.request().postDataJSON()); applyFixturePatch(item!, route.request().postDataJSON());
      }
      return route.fulfill({ json: { value: item } });
    }
    const start = (Number(url.searchParams.get('page') ?? 1) - 1) * 100;
    return route.fulfill({ json: { list: values.slice(start, start + 100).map((value) => ({ value })), total: values.length + (controls.badTotal && kind === 'upstreams' ? 1 : 0) } });
  });
  await page.goto(screen);
  await page.getByRole('button', { name: 'Check references', exact: true }).click();
  return controls;
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Configuration reference diagnostics', exact: true });

test('diagnostics follows paginated saved references and shows affected HTTP and Stream Routes', async ({ page }) => {
  const controls = await setup(page);
  await expect(dialog(page).getByRole('status')).toHaveText('3 reference issue(s) / 0 unavailable collection(s)');
  const service = dialog(page).getByRole('row').filter({ hasText: '/services/broken' });
  await expect(service).toContainText('/routes/http'); await expect(service).toContainText('/stream_routes/tcp');
  await expect(dialog(page)).toContainText('/consumer_groups/missing-group');
  expect(controls.reads).toContain('services?page=2&page_size=100');
  expect(controls.writes).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('diagnostics.png'), animations: 'disabled' });
});

test('unavailable target collections remain unverified and refresh recovers', async ({ page }) => {
  const controls = await setup(page);
  controls.failed.add('upstreams');
  await dialog(page).getByRole('button', { name: 'Refresh reference check' }).click();
  await expect(dialog(page)).toContainText('Reference check is incomplete');
  await expect(dialog(page).getByRole('row').filter({ hasText: '/services/broken' })).toContainText('Not verified');
  controls.failed.clear();
  await dialog(page).getByRole('button', { name: 'Refresh reference check' }).click();
  await expect(dialog(page).getByRole('status')).toHaveText('3 reference issue(s) / 0 unavailable collection(s)');
});

test('inconsistent pagination never produces a clean reference report', async ({ page }) => {
  const controls = await setup(page); controls.badTotal = true;
  await dialog(page).getByRole('button', { name: 'Refresh reference check' }).click();
  await expect(dialog(page)).toContainText('Reference check is incomplete');
  await expect(dialog(page).getByText('No broken references found in the checked scope')).toHaveCount(0);
});

test('source RAW repairs a reference and refreshes diagnostics after saving', async ({ page }) => {
  const controls = await setup(page);
  await dialog(page).getByRole('row').filter({ hasText: '/services/broken' }).getByRole('button', { name: 'Open source RAW' }).click();
  const raw = page.getByRole('dialog', { name: 'Repair reference: /services/broken' });
  await expect(raw.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await uiFillMonacoEditor(page, raw.locator('.monaco-editor'), JSON.stringify({ name: 'Broken service', upstream_id: 'good' }));
  await raw.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(raw.getByText(/Saved at/)).toBeVisible();
  await raw.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog(page).getByRole('status')).toHaveText('2 reference issue(s) / 0 unavailable collection(s)');
  expect(controls.writes).toEqual([{ upstream_id: 'good' }]);
});

test('topology exposes reference diagnostics within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, 'topology');
  await expect(dialog(page).getByRole('status')).toContainText('3 reference issue(s)');
  const bounds = await dialog(page).boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
});


test('known plugin references cover every plugin owner and explain potentially affected Routes', async ({ page }) => {
  const controls = await setup(page);
  controls.data = {
    routes: [{ id: 'grpc', uri: '/grpc', plugins: { 'grpc-transcode': { proto_id: 'missing-route-proto' } } },
      { id: 'using-config', uri: '/config', plugin_config_id: 'shared' },
      { id: 'using-service', uri: '/service', service_id: 'service' }],
    stream_routes: [{ id: 'tcp', service_id: 'service', plugins: { 'traffic-split': { rules: [
      { weighted_upstreams: [{ upstream_id: 'missing-stream-upstream' }] },
    ] } } }],
    services: [{ id: 'service', plugins: { 'grpc-transcode': { proto_id: 'missing-service-proto' } } }],
    plugin_configs: [{ id: 'shared', plugins: { 'traffic-split': { rules: [
      { weighted_upstreams: [{ upstream_id: 'good' }, { upstream_id: 'missing-shared-upstream' }] },
    ] } } }],
    consumers: [{ username: 'alice', group_id: 'group', plugins: { 'grpc-transcode': { proto_id: 999 } } }],
    consumer_groups: [{ id: 'group', plugins: { 'traffic-split': { rules: [
      { weighted_upstreams: [{ upstream_id: 'missing-group-upstream' }] },
    ] } } }],
    global_rules: [{ id: 'global', plugins: { 'grpc-transcode': { proto_id: 'missing-global-proto' } } }],
    upstreams: [{ id: 'good' }], protos: [],
  };
  await dialog(page).getByRole('button', { name: 'Refresh reference check' }).click();
  await expect(dialog(page).getByRole('status')).toHaveText('7 reference issue(s) / 0 unavailable collection(s)');
  const shared = dialog(page).getByRole('row').filter({ hasText: '/plugin_configs/shared' });
  await expect(shared).toContainText('plugins.traffic-split.rules[0].weighted_upstreams[1].upstream_id');
  await expect(shared).toContainText('/routes/using-config');
  const service = dialog(page).getByRole('row').filter({ hasText: '/services/service' });
  await expect(service).toContainText('/routes/using-service');
  await expect(service).toContainText('/stream_routes/tcp');
  await expect(dialog(page).getByRole('row').filter({ hasText: '/consumers/alice' })).toContainText('Depends on the authenticated Consumer');
  await expect(dialog(page).getByRole('row').filter({ hasText: '/consumer_groups/group' })).toContainText('Depends on the authenticated Consumer');
  const global = dialog(page).getByRole('row').filter({ hasText: '/global_rules/global' });
  await expect(global).toContainText('/routes/grpc');
  await expect(global).toContainText('/routes/using-config');
  await expect(global).not.toContainText('/stream_routes/tcp');
  await dialog(page).getByText('Checked scope and limitations', { exact: true }).click();
  await expect(dialog(page)).toContainText('Other plugin references');
  await dialog(page).getByText('Checked scope and limitations', { exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: 'Close diagnostics' })).toBeInViewport();
  expect(controls.writes).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('plugin-reference-diagnostics.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog(page).getByRole('button', { name: 'Close diagnostics' })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('plugin-reference-diagnostics-narrow.png'), animations: 'disabled' });
});

test('valid numeric IDs, inline upstreams, fallback upstreams and unknown plugin fields are not broken references', async ({ page }) => {
  const controls = await setup(page);
  for (const kind of Object.keys(controls.data)) controls.data[kind] = [];
  controls.data.routes = [{ id: 'valid', plugins: {
    'grpc-transcode': { proto_id: 7 },
    'traffic-split': { rules: [{ weighted_upstreams: [
      { upstream_id: 42 }, { upstream: { nodes: { '127.0.0.1:80': 1 } } }, { weight: 1 },
    ] }] },
    'custom-plugin': { upstream_id: 'not-a-known-reference', proto_id: 'not-a-known-reference' },
  } }];
  controls.data.protos = Array.from({ length: 101 }, (_, index) => ({ id: String(index) }));
  controls.data.upstreams = [{ id: '42' }];
  await dialog(page).getByRole('button', { name: 'Refresh reference check' }).click();
  await expect(dialog(page)).toContainText('No broken references found in the checked scope');
  expect(controls.reads).toContain('protos?page=2&page_size=100');
  expect(controls.writes).toEqual([]);
});

test('missing required Proto IDs and malformed upstream IDs are invalid instead of silently clean', async ({ page }) => {
  const controls = await setup(page);
  for (const kind of Object.keys(controls.data)) controls.data[kind] = [];
  controls.data.routes = [{ id: 'invalid', plugins: {
    'grpc-transcode': {}, 'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: null }, { upstream_id: {} }] }] },
  } }];
  await dialog(page).getByRole('button', { name: 'Refresh reference check' }).click();
  await expect(dialog(page).getByRole('status')).toHaveText('3 reference issue(s) / 0 unavailable collection(s)');
  await expect(dialog(page).getByText('Invalid reference', { exact: true })).toHaveCount(3);
  await expect(dialog(page)).toContainText('/protos/(missing)');
  await expect(dialog(page)).toContainText('/upstreams/null');
  expect(controls.writes).toEqual([]);
});

test('unavailable and duplicate Proto collections leave plugin references unverified until a complete refresh', async ({ page }) => {
  const controls = await setup(page);
  for (const kind of Object.keys(controls.data)) controls.data[kind] = [];
  controls.data.routes = [{ id: 'grpc', plugins: { 'grpc-transcode': { proto_id: 'proto' } } }];
  controls.data.protos = [{ id: 'proto' }];
  controls.failed.add('protos');
  await dialog(page).getByRole('button', { name: 'Refresh reference check' }).click();
  await expect(dialog(page)).toContainText('Could not verify: protos');
  await expect(dialog(page).getByRole('row').filter({ hasText: '/routes/grpc' })).toContainText('Not verified');
  await expect(dialog(page).getByText('No broken references found in the checked scope')).toHaveCount(0);
  controls.failed.clear();
  controls.data.protos.push({ id: 'proto' });
  await dialog(page).getByRole('button', { name: 'Refresh reference check' }).click();
  await expect(dialog(page)).toContainText('Could not verify: protos');
  controls.data.protos.pop();
  await dialog(page).getByRole('button', { name: 'Refresh reference check' }).click();
  await expect(dialog(page)).toContainText('No broken references found in the checked scope');
});

test('plugin source RAW can repair a Proto reference without losing unrelated plugins', async ({ page }) => {
  const controls = await setup(page);
  for (const kind of Object.keys(controls.data)) controls.data[kind] = [];
  const plugins = { 'grpc-transcode': { proto_id: 'gone', service: 'helloworld.Greeter', method: 'SayHello' }, 'proxy-rewrite': { uri: '/kept' } };
  controls.data.routes = [{ id: 'grpc', uri: '/grpc', plugins, create_time: 1, update_time: 1 }];
  controls.data.protos = [{ id: 'proto' }];
  await dialog(page).getByRole('button', { name: 'Refresh reference check' }).click();
  await dialog(page).getByRole('row').filter({ hasText: '/routes/grpc' }).getByRole('button', { name: 'Open source RAW' }).click();
  const raw = page.getByRole('dialog', { name: 'Repair reference: /routes/grpc' });
  await expect(raw.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  const repaired = { ...plugins, 'grpc-transcode': { ...plugins['grpc-transcode'], proto_id: 'proto' } };
  await uiFillMonacoEditor(page, raw.locator('.monaco-editor'), JSON.stringify({ uri: '/grpc', plugins: repaired }));
  await raw.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(raw.getByText(/Saved at/)).toBeVisible();
  await raw.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog(page)).toContainText('No broken references found in the checked scope');
  expect(controls.writes).toEqual([{ plugins: { 'grpc-transcode': { proto_id: 'proto' } } }]);
  expect(controls.data.routes[0].plugins).toEqual(repaired);
});
