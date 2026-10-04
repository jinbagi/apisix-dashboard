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

import { prepareHistoryRestore } from '@/apis/resource-history';
import { historyEntrySchema } from '@/stores/resourceHistory';
import { getHistoryTarget } from '@/utils/historyResource';

const payload = { name: 'History fixture', uri: '/history/*', desc: 'Before', upstream: { nodes: { '127.0.0.1:1980': 1 } } };
async function setup(page: Page, initial: Record<string, Record<string, unknown>> = {}) {
  const records = new Map(Object.entries(initial).map(([path, value]) => [path, { create_time: 1, update_time: 1, ...value }]));
  const controls = { records, ignoreWrites: false, failAfterWrite: false, readBarrier: undefined as Promise<void> | undefined, failedReads: new Set<string>(), writes: [] as { method: string; path: string; body: unknown }[] };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('history-fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    const method = request.method();
    if (['PUT', 'PATCH', 'POST', 'DELETE'].includes(method)) {
      const body = method === 'DELETE' ? undefined : request.postDataJSON();
      controls.writes.push({ method, path, body });
      const key = method === 'POST' ? `${path}/generated-history` : path;
      if (!controls.ignoreWrites) {
        if (method === 'DELETE') records.delete(key);
        else records.set(key, { ...(method === 'PATCH' ? records.get(key) : {}), ...body, id: key.split('/').pop(), server_default: 'observed', create_time: 1, update_time: 1 });
      }
      if (controls.failAfterWrite) controls.failedReads.add(key);
      return route.fulfill({ json: { value: records.get(key) ?? {} } });
    }
    if (controls.writes.length && controls.records.has(path)) await controls.readBarrier;
    if (controls.failedReads.has(path)) return route.fulfill({ status: 503, json: { error_msg: 'Fixture unavailable' } });
    if (records.has(path)) return route.fulfill({ json: { value: records.get(path) } });
    if (/^\/routes\/.+/.test(path)) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
    if (path === '/routes') return route.fulfill({ json: { list: [...records.entries()].filter(([key]) => /^\/routes\/[^/]+$/.test(key)).map(([, value]) => ({ value })), total: records.size } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  return controls;
}
const history = (page: Page) => page.getByRole('dialog', { name: 'Resource change history', exact: true });
async function openGlobalHistory(page: Page) {
  await page.getByRole('button', { name: 'Activity Log', exact: true }).click();
  await page.getByRole('dialog', { name: 'Activity Log', exact: true }).getByRole('button', { name: 'Change history', exact: true }).click();
}
async function method(page: Page, value: string) {
  await page.getByRole('combobox', { name: 'Method' }).click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText(value, { exact: true }).click();
}
async function execute(page: Page, verb: string) {
  await page.getByRole('button', { name: new RegExp(`Send ${verb}`) }).click();
  if (verb === 'PUT' || verb === 'DELETE') await page.getByRole('dialog').filter({ hasText: `${verb} /routes/` }).getByRole('button', { name: verb === 'PUT' ? 'Execute' : 'Delete', exact: true }).click();
}
async function consoleBody(page: Page, body: unknown) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((value) => navigator.clipboard.writeText(value), JSON.stringify(body, null, 2));
  const editor = page.locator('.monaco-editor').first().getByRole('textbox');
  await page.locator('.monaco-editor').first().click();
  await editor.press('ControlOrMeta+A');
  await editor.press('ControlOrMeta+V');
  await page.getByText('Request JSON', { exact: true }).click();
}

test('forms record custom-ID creation, fresh update, and verified deletion once each', async ({ page }) => {
  const controls = await setup(page);
  await page.goto('routes/add');
  await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
  await uiFillMonacoEditor(page, page.getByRole('tabpanel', { name: 'Payload JSON' }).locator('.monaco-editor'), JSON.stringify({ id: 'history-form', ...payload }));
  await page.getByRole('tabpanel', { name: 'Payload JSON' }).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(/routes\/detail\/history-form/);
  await page.getByRole('tab', { name: 'Configuration', exact: true }).click();
  controls.records.set('/routes/history-form', { ...controls.records.get('/routes/history-form'), desc: 'Fresh server before' });
  await page.getByLabel('Description').first().fill('After form');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
  await expect.poll(() => controls.writes.length).toBe(2);
  await page.getByRole('tab', { name: 'Admin API JSON', exact: true }).click();
  await page.getByRole('button', { name: 'Change history', exact: true }).click();
  await expect(history(page).getByRole('button', { name: 'Compare change' })).toHaveCount(2);
  const update = history(page).getByRole('row').filter({ hasText: 'update · form' });
  await update.getByRole('button', { name: 'Compare change' }).click();
  const comparison = page.getByRole('dialog', { name: 'Recorded resource change' });
  await expect(comparison).toContainText('Fresh server before');
  await expect(comparison).toContainText('observed');
  await comparison.getByRole('button', { name: 'Back to history' }).click();
  await expect(history(page).getByRole('row').filter({ hasText: 'create · form' }).getByRole('button', { name: 'Restore previous values' })).toBeDisabled();
  await history(page).getByRole('button', { name: 'Close history' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Delete Route', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => controls.records.has('/routes/history-form')).toBe(false);
  await expect(page).toHaveURL(/routes(?:\?[^/]*)?$/);
  await openGlobalHistory(page);
  await expect(history(page).getByRole('button', { name: 'Compare change' })).toHaveCount(3);
  await expect(history(page)).toContainText('delete · form');
  await page.screenshot({ path: test.info().outputPath('history-lifecycle.png'), animations: 'disabled' });
});

test('accepted form writes with a failed read-back retain the draft and no verified history', async ({ page }) => {
  const controls = await setup(page, { '/routes/history-form': { id: 'history-form', ...payload } });
  await page.goto('routes/detail/history-form');
  await page.getByRole('tab', { name: 'Configuration', exact: true }).click();
  await page.getByLabel('Description').first().fill('Unverified change');
  controls.failAfterWrite = true;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
  await expect(page.getByText(/write was accepted, but read-back could not verify it/).first()).toBeVisible();
  expect(controls.writes).toHaveLength(1);
  await expect(page.getByLabel('Description').first()).toHaveValue('Unverified change');
  await openGlobalHistory(page);
  await expect(history(page).getByRole('button', { name: 'Compare change' })).toHaveCount(0);
});

test('Console records generated POST, PATCH and DELETE with actual read-back state', async ({ page }) => {
  const controls = await setup(page);
  await page.goto('raw_api');
  await method(page, 'POST');
  await consoleBody(page, payload);
  await execute(page, 'POST');
  await expect(page.getByText(/Read-back verified\./)).toBeVisible();
  await method(page, 'PATCH');
  await page.getByRole('combobox', { name: 'Path suffix' }).fill('generated-history');
  await consoleBody(page, { desc: 'Console changed' });
  await execute(page, 'PATCH');
  await expect.poll(() => controls.records.get('/routes/generated-history')?.desc).toBe('Console changed');
  await expect(page.getByText(/Read-back verified\./)).toBeVisible();
  await method(page, 'DELETE');
  await execute(page, 'DELETE');
  await expect(page.getByText(/Read-back verified\./)).toBeVisible();
  await page.getByRole('button', { name: 'Change history', exact: true }).click();
  await expect(history(page).getByRole('button', { name: 'Compare change' })).toHaveCount(3);
  await expect(history(page)).toContainText('create · console');
  await expect(history(page)).toContainText('update · console');
  await expect(history(page)).toContainText('delete · console');
  expect(controls.writes.map((write) => write.method)).toEqual(['POST', 'PATCH', 'DELETE']);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await history(page).boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await expect(history(page).getByRole('button', { name: 'Compare change' }).first()).toBeInViewport();
  await expect(history(page).getByRole('button', { name: 'Close history' })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('history-narrow.png'), animations: 'disabled' });
});

test('Console keeps accepted HTTP responses for unverified writes and executes unsupported subpaths honestly', async ({ page }) => {
  const controls = await setup(page, { '/routes/console': { id: 'console', ...payload } });
  await page.goto('raw_api');
  await method(page, 'PATCH');
  await page.getByRole('combobox', { name: 'Path suffix' }).fill('console');
  await consoleBody(page, { desc: 'Unverified' });
  controls.ignoreWrites = true;
  await execute(page, 'PATCH');
  await expect(page.getByText(/write was accepted, but read-back could not verify it/)).toBeVisible();
  await expect(page.locator('.ant-tag').filter({ hasText: '200' }).first()).toBeVisible();
  expect(controls.writes).toHaveLength(1);
  await page.screenshot({ path: test.info().outputPath('console-unverified.png'), animations: 'disabled' });
  await page.getByRole('combobox', { name: 'Path suffix' }).fill('console/plugins/example');
  await consoleBody(page, {});
  await execute(page, 'PATCH');
  await expect(page.getByText(/No resource history: only supported exact resource writes/)).toBeVisible();
  expect(controls.writes).toHaveLength(2);
  await page.getByRole('button', { name: 'Change history', exact: true }).click();
  await expect(history(page).getByRole('button', { name: 'Compare change' })).toHaveCount(0);
});

test('import records verified creates and updates, with explicit opt-in encrypted persistence', async ({ page }) => {
  await setup(page, { '/routes/import-existing': { id: 'import-existing', uri: '/before' } });
  await page.goto('export_import');
  await page.locator('input[type="file"]').setInputFiles({ name: 'history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    version: 3, exportedAt: '2026-10-04T00:00:00Z', resources: { routes: [{ id: 'import-new', uri: '/new' }, { id: 'import-existing', uri: '/after' }] },
  })) });
  await page.getByRole('button', { name: 'Import Selected Resources', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm Import', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import Complete: 2 succeeded, 0 failed')).toBeVisible();
  await openGlobalHistory(page);
  await expect(history(page)).toContainText('create · import');
  await expect(history(page)).toContainText('update · import');
  expect(await page.evaluate(() => localStorage.getItem('resource-history:v1'))).toBeNull();
  for (const name of ['History password', 'Confirm history password']) await history(page).getByRole('textbox', { name, exact: true }).fill('history-fixture-password');
  await history(page).getByRole('button', { name: 'Save encrypted history' }).click();
  await expect(history(page)).toContainText('Encrypted history saved');
  const stored = await page.evaluate(() => localStorage.getItem('resource-history:v1'));
  expect(stored).not.toContain('/routes/'); expect(stored).not.toContain('history-fixture-key'); expect(stored).not.toContain('history-fixture-password');
  await page.reload();
  await openGlobalHistory(page);
  await expect(history(page).getByRole('button', { name: 'Compare change' })).toHaveCount(0);
  await history(page).getByRole('textbox', { name: 'History password', exact: true }).fill('history-fixture-password');
  await history(page).getByRole('button', { name: 'Unlock saved history' }).click();
  await expect(history(page).getByRole('button', { name: 'Compare change' })).toHaveCount(2);
});

test('legacy archives migrate, inconsistent lifecycle entries fail validation, and create restore sends no request', async () => {
  const old = { id: 'legacy', at: 1, api: '/routes/legacy', before: { uri: '/a' }, after: { uri: '/b' } };
  expect(historyEntrySchema.parse(old)).toMatchObject({ operation: 'update', source: 'legacy', verification: 'full' });
  expect(historyEntrySchema.safeParse({ ...old, operation: 'delete' }).success).toBe(false);
  expect(historyEntrySchema.safeParse({ ...old, api: '/routes/legacy/plugins' }).success).toBe(false);
  const created = historyEntrySchema.parse({ ...old, operation: 'create', before: null });
  await expect(prepareHistoryRestore(created)).rejects.toThrow('Create and delete events are view only');
  for (const api of ['/routes/a/plugins', '/routes/a?ttl=1', '/routes/%2e%2e', '/routes/a%2fb', '/schema/routes']) expect(getHistoryTarget(api)).toBeUndefined();
  expect(getHistoryTarget('/consumers/team/credentials/key')).toEqual({ detail: true, generated: false });
  expect(getHistoryTarget('/services/api/graphql_cost_decorations')).toEqual({ detail: false, generated: true });
});


test('Console displays the accepted response while read-back is pending', async ({ page }) => {
  const controls = await setup(page, { '/routes/pending': { id: 'pending', ...payload } });
  await page.goto('raw_api');
  await method(page, 'PATCH');
  await page.getByRole('combobox', { name: 'Path suffix' }).fill('pending');
  await consoleBody(page, { desc: 'After' });
  let release!: () => void;
  controls.readBarrier = new Promise<void>((resolve) => { release = resolve; });
  try {
    await execute(page, 'PATCH');
    await expect(page.locator('.ant-tag').filter({ hasText: '200' }).first()).toBeVisible();
    await expect(page.getByText('Request accepted. Verifying read-back for resource history…', { exact: true })).toBeVisible();
    expect(controls.writes).toHaveLength(1);
  } finally { release(); }
  await expect(page.getByText(/Read-back verified\./)).toBeVisible();
  await page.getByRole('button', { name: 'Change history', exact: true }).click();
  await expect(history(page).getByRole('button', { name: 'Compare change' })).toHaveCount(1);
});
