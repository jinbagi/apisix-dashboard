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

import { relatedReferences } from '@/utils/relatedResources';

const original = { id: 'source', name: 'Source route', uri: '/source', service_id: 'svc', plugin_config_id: 'plugins', upstream_id: 'direct', create_time: 1, update_time: 1 };
async function setup(page: Page) {
  const records = new Map<string, Record<string, unknown>>([
    ['/routes/source', original],
    ['/services/svc', { id: 'svc', name: 'Linked service', upstream_id: 'inherited' }],
    ['/services/new-service', { id: 'new-service', name: 'New service' }],
    ['/upstreams/direct', { id: 'direct', nodes: { 'direct.example:80': 1 } }],
    ['/upstreams/inherited', { id: 'inherited', nodes: { 'inherited.example:80': 1 } }],
    ['/plugin_configs/plugins', { id: 'plugins', plugins: { cors: { allow_origins: '*' } } }],
  ]);
  const writes: string[] = [];
  const reads: string[] = [];
  const failures = new Set<string>();
  const controls: { hold?: string; release?: () => void } = {};
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    if (request.method() !== 'GET') { writes.push(path); return route.fulfill({ status: 500, json: { error_msg: 'Read-only inspection must not write' } }); }
    reads.push(path);
    if (path === controls.hold) await new Promise<void>((resolve) => { controls.release = resolve; });
    if (failures.has(path)) return route.fulfill({ status: 503, json: { error_msg: 'Fixture unavailable' } });
    if (records.has(path)) return route.fulfill({ json: { value: records.get(path) } });
    if (path === '/routes') return route.fulfill({ json: { list: [{ value: original }], total: 1 } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('routes');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Route: Source route' });
  await expect(drawer.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('"uri"');
  const draft = { uri: '/unsaved', name: 'Draft name', service_id: 'svc', upstream_id: 'direct', plugin_config_id: 'plugins', future_field: { keep: true } };
  await page.evaluate((value) => window.__monacoEditor__?.setValue(JSON.stringify(value, null, 2)), draft);
  await drawer.getByRole('button', { name: 'Related resources', exact: true }).click();
  const panel = drawer.getByRole('complementary', { name: 'Related resource inspector' });
  return { records, reads, writes, controls, failures, drawer, panel, draft };
}
async function choose(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Reference to inspect' }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByRole('option', { name, exact: true })).toBeHidden();
}

test('RAW inspects direct and Service upstream references without replacing or saving a draft', async ({ page }, info) => {
  const { panel, writes, draft } = await setup(page);
  await expect(panel.getByLabel('Related resource JSON')).toContainText('Linked service');
  await choose(page, 'Service Upstream: inherited');
  await expect(panel.getByLabel('Related resource JSON')).toContainText('inherited.example:80');
  await choose(page, 'Upstream: direct');
  await expect(panel.getByLabel('Related resource JSON')).toContainText('direct.example:80');
  await choose(page, 'Plugin Config: plugins');
  await expect(panel.getByLabel('Related resource JSON')).toContainText('allow_origins');
  await expect(panel.getByRole('link', { name: 'Open detail in new tab' })).toHaveAttribute('href', /plugin_configs\/detail\/plugins$/);
  await page.screenshot({ path: info.outputPath('raw-related-resources.png'), animations: 'disabled' });
  expect(JSON.parse((await page.evaluate(() => window.__monacoEditor__?.getValue()))!)).toEqual(draft);
  expect(writes).toEqual([]);
});

test('reference changes, invalid JSON and close/reopen keep the editor draft intact', async ({ page }) => {
  const { panel, drawer, reads, writes, draft } = await setup(page);
  await expect(panel.getByLabel('Related resource JSON')).toContainText('Linked service');
  const beforeReads = reads.filter((path) => path === '/services/svc').length;
  await page.evaluate((value) => window.__monacoEditor__?.setValue(JSON.stringify({ ...value, desc: 'Only text changed' })), draft);
  await expect(panel.getByLabel('Related resource JSON')).toContainText('Linked service');
  expect(reads.filter((path) => path === '/services/svc')).toHaveLength(beforeReads);
  await page.evaluate((value) => window.__monacoEditor__?.setValue(JSON.stringify({ ...value, service_id: 'new-service' })), draft);
  await expect(panel.getByLabel('Related resource JSON')).toContainText('New service');
  await page.evaluate(() => window.__monacoEditor__?.setValue('{invalid'));
  await expect(panel.getByText('Fix the draft JSON to inspect its references.')).toBeVisible();
  await panel.getByRole('button', { name: 'Close references' }).click();
  await drawer.getByRole('button', { name: 'Related resources', exact: true }).click();
  expect(await page.evaluate(() => window.__monacoEditor__?.getValue())).toBe('{invalid');
  expect(writes).toEqual([]);
});

test('failed and wrong-identity reads are explicit and can retry without changing the draft', async ({ page }) => {
  const { panel, failures, records, writes } = await setup(page);
  await expect(panel.getByLabel('Related resource JSON')).toContainText('Linked service');
  failures.add('/services/svc');
  await panel.getByRole('button', { name: 'Refresh reference' }).click();
  await expect(panel.getByText('Unable to inspect reference')).toBeVisible();
  await expect(panel.getByLabel('Related resource JSON')).toHaveCount(0);
  failures.clear();
  records.set('/services/svc', { id: 'wrong', name: 'Do not show' });
  await panel.getByRole('button', { name: 'Refresh reference' }).click();
  await expect(panel.getByText('The Admin API did not return the requested resource.')).toBeVisible();
  records.set('/services/svc', { id: 'svc', name: 'Recovered' });
  await panel.getByRole('button', { name: 'Refresh reference' }).click();
  await expect(panel.getByLabel('Related resource JSON')).toContainText('Recovered');
  expect(writes).toEqual([]);
});

test('a late reference read cannot replace a newer selection', async ({ page }) => {
  const { panel, controls, reads } = await setup(page);
  await expect(panel.getByLabel('Related resource JSON')).toContainText('Linked service');
  controls.hold = '/upstreams/direct';
  await choose(page, 'Upstream: direct');
  await expect.poll(() => reads.includes('/upstreams/direct')).toBe(true);
  await choose(page, 'Plugin Config: plugins');
  await expect(panel.getByLabel('Related resource JSON')).toContainText('allow_origins');
  controls.release?.();
  await expect(panel.getByLabel('Related resource JSON')).toContainText('allow_origins');
});

test('narrow RAW switches reference/editor views while preserving cursor and draft', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { panel, drawer, draft, writes } = await setup(page);
  await page.evaluate(() => window.__monacoEditor__?.setPosition({ lineNumber: 3, column: 4 }));
  await expect(panel.getByLabel('Related resource JSON')).toContainText('Linked service');
  await expect(drawer.getByRole('textbox', { name: 'Editor content' })).toBeHidden();
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('raw-related-resources-narrow.png'), animations: 'disabled' });
  await drawer.getByText('Editor', { exact: true }).click();
  await expect(drawer.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  expect(JSON.parse((await page.evaluate(() => window.__monacoEditor__?.getValue()))!)).toEqual(draft);
  expect(await page.evaluate(() => window.__monacoEditor__?.getPosition())).toEqual({ lineNumber: 3, column: 4 });
  await drawer.getByText('References', { exact: true }).click();
  await panel.getByRole('button', { name: 'Close references' }).click();
  await expect(drawer.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.hasTextFocus())).toBe(true);
  expect(writes).toEqual([]);
});

test('reference discovery keeps resource scope, escaped IDs and invalid references explicit', () => {
  expect(relatedReferences('/routes/one', JSON.stringify({ service_id: 0, upstream_id: 'name/part', plugin_config_id: {} }))).toEqual({
    references: [{ api: '/services/0', label: 'Service: 0' }, { api: '/upstreams/name%2Fpart', label: 'Upstream: name/part' }], warnings: ['plugin_config_id must contain a valid resource ID.'],
  });
  expect(relatedReferences('/services/one', '{"service_id":"ignored","plugin_config_id":"ignored","upstream_id":"u"}').references).toEqual([{ api: '/upstreams/u', label: 'Upstream: u' }]);
  expect(relatedReferences('/stream_routes/one', '{"service_id":"s","plugin_config_id":"ignored"}').references).toEqual([{ api: '/services/s', label: 'Service: s' }]);
});
