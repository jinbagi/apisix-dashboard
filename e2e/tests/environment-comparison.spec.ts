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

import { mapImportEnvironment } from '@/apis/environment-import';
import { type ExportData } from '@/apis/export-import';

const makeData = (routes: Record<string, unknown>[]): ExportData => ({
  version: 3, exportedAt: '2026-10-04T00:00:00Z',
  resources: { routes, services: [], upstreams: [], streamRoutes: [], consumers: [], credentials: [],
    consumerGroups: [], ssls: [], globalRules: [], pluginConfigs: [], pluginMetadata: [], protos: [], secrets: [] },
});
async function setup(page: Page, data: ExportData, existing: Record<string, Record<string, unknown>> = {}) {
  const records = new Map(Object.entries(existing));
  const failures = new Map<string, number>();
  const writes: { path: string; body: unknown }[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    if (request.method() === 'PUT') {
      writes.push({ path, body: request.postDataJSON() });
      records.set(path, request.postDataJSON());
      return route.fulfill({ json: { value: request.postDataJSON() } });
    }
    if (failures.has(path)) return route.fulfill({ status: failures.get(path), json: { error_msg: 'Read unavailable' } });
    if (records.has(path)) return route.fulfill({ json: { value: records.get(path) } });
    if (/^\/(routes|consumers|secrets|services|upstreams|consumer_groups|plugin_configs)\/.+/.test(path)) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('export_import');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'preview.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  return { records, failures, writes };
}
const modal = (page: Page) => page.getByRole('dialog', { name: 'Confirm Import', exact: true });
async function preview(page: Page) {
  await page.getByRole('button', { name: 'Import Selected Resources', exact: true }).click();
  await expect(modal(page)).toBeVisible();
}

test('environment mapping preserves unknown fields, numeric references and child ownership', async () => {
  const data = makeData([{ id: 'route', service_id: 'dev-service', upstream_id: 7, plugin_config_id: 'dev-config', future: { keep: true } }]);
  data.resources.services = [{ id: 'dev-service', upstream_id: 7 }];
  data.resources.upstreams = [{ id: 7, nodes: { backend: 1 } }];
  data.resources.consumers = [{ username: 'alice', group_id: 'dev-group' }];
  data.resources.credentials = [{ id: 'main', username: 'alice', plugins: {} }];
  data.resources.graphqlCostDecorations = [{ id: 'cost', service_id: 'dev-service' }];
  const mapped = mapImportEnvironment(data, JSON.stringify({ services: { 'dev-service': 'prod-service' }, upstreams: { '7': 'prod-upstream' },
    pluginConfigs: { 'dev-config': 'prod-config' }, consumers: { alice: 'prod-alice' }, consumerGroups: { 'dev-group': 'prod-group' } }));
  expect(mapped.resources.routes[0]).toEqual({ id: 'route', service_id: 'prod-service', upstream_id: 'prod-upstream', plugin_config_id: 'prod-config', future: { keep: true } });
  expect(mapped.resources.credentials[0].username).toBe('prod-alice');
  expect(mapped.resources.graphqlCostDecorations![0].service_id).toBe('prod-service');
  expect(mapped.resources.consumers[0].group_id).toBe('prod-group');
  expect(data.resources.routes[0].upstream_id).toBe(7);
});

test('environment comparison applies only selected resources', async ({ page }) => {
  const controls = await setup(page, makeData([{ id: 'chosen', uri: '/chosen' }, { id: 'leave', uri: '/leave' }]));
  await page.getByRole('button', { name: 'Compare with current environment' }).click();
  await modal(page).getByRole('checkbox', { name: 'Apply /routes/leave', exact: true }).uncheck();
  await expect(modal(page)).toContainText('1 item(s) selected');
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 1 succeeded, 0 failed')).toBeVisible();
  expect(controls.writes.map((write) => write.path)).toEqual(['/routes/chosen']);
});

test('mapped dependencies are previewed together and required new resources cannot be deselected', async ({ page }) => {
  const data = makeData([{ id: 'route', uri: '/route', service_id: 'dev-service' }]);
  data.resources.services = [{ id: 'dev-service', upstream_id: 'dev-upstream' }];
  data.resources.upstreams = [{ id: 'dev-upstream', nodes: { backend: 1 } }];
  const controls = await setup(page, data);
  await page.getByText('Environment ID mappings (optional)', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Environment ID mappings' }).fill(JSON.stringify({ services: { 'dev-service': 'prod-service' }, upstreams: { 'dev-upstream': 'prod-upstream' } }));
  await preview(page);
  await expect(modal(page)).toContainText('/services/prod-service');
  await modal(page).getByRole('checkbox', { name: 'Apply /upstreams/prod-upstream', exact: true }).uncheck();
  await expect(modal(page)).toContainText('Select required new dependencies');
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await modal(page).getByRole('checkbox', { name: 'Apply /upstreams/prod-upstream', exact: true }).check();
  await page.screenshot({ path: test.info().outputPath('comparison.png'), animations: 'disabled' });
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 3 succeeded, 0 failed')).toBeVisible();
  expect(controls.writes).toEqual([
    { path: '/upstreams/prod-upstream', body: { nodes: { backend: 1 } } },
    { path: '/services/prod-service', body: { upstream_id: 'prod-upstream' } },
    { path: '/routes/route', body: { uri: '/route', service_id: 'prod-service' } },
  ]);
});

test('invalid ID maps and duplicate mapped destinations cannot be applied', async ({ page }) => {
  const controls = await setup(page, makeData([{ id: 'a', uri: '/a' }, { id: 'b', uri: '/b' }]));
  await page.getByText('Environment ID mappings (optional)', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Environment ID mappings' }).fill('{"routes":{"a":"../escape"}}');
  await page.getByRole('button', { name: 'Compare with current environment' }).click();
  await expect(page.getByText('Invalid destination ID in routes', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Environment ID mappings' }).fill('{"routes":{"a":"same","b":"same"}}');
  await preview(page);
  await expect(modal(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  expect(controls.writes).toEqual([]);
});

test('mapped destinations are checked again before applying selected changes', async ({ page }) => {
  const controls = await setup(page, makeData([{ id: 'dev', uri: '/new' }]), { '/routes/prod': { id: 'prod', uri: '/before' } });
  await page.getByText('Environment ID mappings (optional)', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Environment ID mappings' }).fill('{"routes":{"dev":"prod"}}');
  await preview(page); controls.records.set('/routes/prod', { id: 'prod', uri: '/concurrent' });
  await modal(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 0 succeeded, 1 failed')).toBeVisible();
  expect(controls.writes).toEqual([]);
});
