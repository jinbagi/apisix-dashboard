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

async function setup(page: Page, kind = 'upstreams') {
  const writes: string[] = [];
  const reads: string[] = [];
  const failures = new Set<string>();
  const data: Record<string, Record<string, unknown>[]> = {
    upstreams: [{ id: 'target', name: 'target', nodes: { '127.0.0.1:8080': 1 }, type: 'roundrobin', create_time: 1, update_time: 1 }],
    services: [{ id: 'shared', name: 'shared', upstream_id: 'target', create_time: 1, update_time: 1 }],
    plugin_configs: [{ id: 'target', plugins: {}, create_time: 1, update_time: 1 }],
    routes: [
      { id: 'direct', uri: '/direct', upstream_id: 'target' },
      { id: 'indirect', uri: '/indirect', service_id: 'shared' },
      { id: 'override', uri: '/override', service_id: 'shared', upstream: { nodes: { other: 1 } } },
      { id: 'config-route', uri: '/config', plugin_config_id: 'target' },
    ],
    stream_routes: [{ id: 'stream', service_id: 'shared', server_port: 9000 }],
  };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/apisix/admin/', '');
    if (request.method() !== 'GET') writes.push(path);
    reads.push(path + url.search);
    if (failures.has(path)) return route.fulfill({ status: 503, json: { error_msg: 'Unavailable' } });
    const [resource, id] = path.split('/');
    if (path === 'plugins/list') return route.fulfill({ json: [] });
    if (id) return route.fulfill({ json: { value: data[resource]?.find((item) => item.id === id) } });
    const values = data[resource] ?? [];
    const paginated = resource === 'routes';
    const listed = paginated ? (url.searchParams.get('page') === '2' ? values.slice(2) : values.slice(0, 2)) : values;
    return route.fulfill({ json: { list: listed.map((value) => ({ value })), total: paginated ? 102 : values.length } });
  });
  await page.goto(kind + '/detail/' + (kind === 'services' ? 'shared' : 'target'));
  return { writes, reads, failures };
}
const modal = (page: Page) => page.getByRole('dialog', { name: 'Configuration impact', exact: true });
async function analyze(page: Page) {
  await page.getByRole('button', { name: 'Analyze impact', exact: true }).first().click();
  await expect(modal(page)).toBeVisible();
}

test('upstream impact follows direct, indirect and Stream Route references across pages', async ({ page }) => {
  const controls = await setup(page);
  await analyze(page);
  await expect(modal(page)).toContainText('3 potentially affected route(s)');
  await expect(modal(page)).toContainText('routes/indirect → services/shared → upstreams/target');
  await expect(modal(page)).toContainText('stream_routes/stream → services/shared → upstreams/target');
  await expect(modal(page).getByRole('row').filter({ hasText: 'routes/override' })).toContainText('Route overrides Service upstream');
  expect(controls.reads).toContain('routes?page=2&page_size=100');
  expect(controls.writes).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('impact.png'), animations: 'disabled' });
});

for (const kind of ['services', 'plugin_configs']) {
  test(`${kind} details expose their affected Routes`, async ({ page }) => {
    const controls = await setup(page, kind);
    await analyze(page);
    await expect(modal(page)).toContainText(kind === 'services' ? '3 potentially affected route(s)' : '1 potentially affected route(s)');
    expect(controls.writes).toEqual([]);
  });
}

test('failed collection reads never claim no impact and refresh recovers', async ({ page }) => {
  const controls = await setup(page);
  controls.failures.add('routes');
  await analyze(page);
  await expect(modal(page).getByText('Impact could not be verified')).toBeVisible();
  await expect(modal(page).getByRole('table')).toHaveCount(0);
  controls.failures.clear();
  await modal(page).getByRole('button', { name: 'Refresh impact' }).click();
  await expect(modal(page)).toContainText('3 potentially affected route(s)');
});

test('analysis preserves form drafts and stays inside a narrow viewport', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Description', { exact: true }).fill('Unsaved configuration');
  await page.setViewportSize({ width: 390, height: 844 });
  await analyze(page);
  await expect(modal(page)).toContainText('3 potentially affected route(s)');
  const box = await modal(page).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  await modal(page).getByRole('button', { name: 'Close impact' }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Unsaved configuration');
});

