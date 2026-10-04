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

const exportData = { version: 3, exportedAt: '2026-10-04T00:00:00Z', resources: {
  routes: [{ id: 'route-canary', name: 'Canary route', uri: '/canary/*', service_id: 'service-canary' }],
  services: [{ id: 'service-canary', name: 'Canary service', upstream_id: 'upstream-canary' }],
  upstreams: [{ id: 'upstream-canary', name: 'Canary upstream', nodes: { '127.0.0.1:1980': 1 } }],
} };
async function setup(page: Page, data = exportData) {
  const records = new Map<string, Record<string, unknown>>();
  const controls = { records, writes: [] as string[], ignore: new Set<string>(), failOnceAfterWrite: new Set<string>() };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('change-set-ui-fixture')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    if (request.method() === 'PUT' || request.method() === 'PATCH') {
      controls.writes.push(path);
      if (!controls.ignore.has(path)) records.set(path, { ...request.postDataJSON(), id: path.split('/').at(-1) });
      return route.fulfill({ json: { value: records.get(path), key: `/apisix${path}` } });
    }
    if (controls.writes.length && controls.failOnceAfterWrite.delete(path)) return route.fulfill({ status: 503, json: { error_msg: 'Fixture temporarily unavailable' } });
    if (records.has(path)) return route.fulfill({ json: { value: records.get(path), key: `/apisix${path}` } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    if (/^\/(routes|services|upstreams)\/[^/]+$/.test(path)) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
    return route.fulfill({ json: { list: [...records.entries()].filter(([key]) => key.startsWith(path + '/')).map(([, value]) => ({ value })), total: records.size } });
  });
  await page.goto('export_import');
  await page.locator('input[type="file"]').setInputFiles({ name: 'canary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  return controls;
}
async function stage(page: Page) {
  await page.getByRole('button', { name: 'Import Selected Resources', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm Import', exact: true }).getByRole('button', { name: 'Stage for resumable import', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Change sets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Change sets', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Change sets', exact: true })).toHaveClass(/ant-menu-item-selected/);
}
async function apply(page: Page, count: number) {
  await page.getByRole('button', { name: `Apply ${count} changes`, exact: true }).click();
  await page.getByRole('dialog', { name: 'Apply change set', exact: true }).getByRole('button', { name: `Apply ${count} changes`, exact: true }).click();
}

test('stages native import resources, shows complete comparison and order, then verifies once', async ({ page }) => {
  const controls = await setup(page); await stage(page); expect(controls.writes).toEqual([]);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply 3 changes', exact: true })).toBeEnabled();
  await expect(page.locator('.ant-card').nth(0)).toContainText('/upstreams/upstream-canary');
  await expect(page.locator('.ant-card').nth(1)).toContainText('/services/service-canary');
  await expect(page.locator('.ant-card').nth(2)).toContainText('/routes/route-canary');
  await page.locator('.ant-card').nth(2).getByRole('button', { name: 'Compare JSON' }).click();
  const diff = page.getByRole('dialog', { name: 'Change-set JSON comparison', exact: true });
  await expect(diff).toBeVisible(); await diff.getByRole('button', { name: 'Back to change set', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('change-set-desktop.png'), animations: 'disabled', fullPage: true });
  await apply(page, 3); await expect(page.getByText('3 staged · 3 verified', { exact: true })).toBeVisible();
  expect(controls.writes).toEqual(['/upstreams/upstream-canary', '/services/service-canary', '/routes/route-canary']);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Apply.*changes$/ })).toBeDisabled(); expect(controls.writes).toHaveLength(3);
});

test('partial failure retains precise results and will not retry accepted but unverified items', async ({ page }) => {
  const controls = await setup(page); controls.ignore.add('/services/service-canary'); await stage(page);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click(); await apply(page, 3);
  await expect(page.getByText('Execution stopped. Remaining items were not applied.', { exact: true })).toBeVisible();
  await expect(page.locator('.ant-card').nth(0)).toContainText('Verified');
  await expect(page.locator('.ant-card').nth(1)).toContainText('Uncertain');
  expect(controls.writes).toEqual(['/upstreams/upstream-canary', '/services/service-canary']);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Apply.*changes$/ })).toBeDisabled();
  await expect(page.getByText(/A previous write may have been applied/)).toBeVisible(); expect(controls.writes).toHaveLength(2);
});

test('create-only preview blocks an ID taken after staging and fits a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const controls = await setup(page); await stage(page);
  controls.records.set('/upstreams/upstream-canary', { id: 'upstream-canary', nodes: { '127.0.0.1:1999': 1 } });
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click();
  await expect(page.getByText(/The destination changed since this draft was staged/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Apply.*changes$/ })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('change-set-narrow.png'), animations: 'disabled', fullPage: true });
  expect(controls.writes).toEqual([]);
});

test('RAW staging preserves the open editor and carries its original concurrency baseline', async ({ page }) => {
  const controls = await setup(page);
  const original = { uri: '/raw/*', name: 'RAW staged route', desc: 'Before' };
  controls.records.set('/routes/raw-staged', { id: 'raw-staged', ...original });
  await page.goto('routes'); await page.getByRole('row').filter({ hasText: 'raw-staged' }).getByRole('button', { name: 'Raw', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: /Route: RAW staged route/ });
  await uiFillMonacoEditor(page, drawer.locator('.monaco-editor'), JSON.stringify({ ...original, desc: 'Staged from RAW' }));
  await drawer.getByRole('button', { name: 'Stage change', exact: true }).click();
  await expect(drawer).toBeVisible(); expect(controls.writes).toEqual([]);
  await drawer.getByRole('button', { name: 'Minimize', exact: true }).click();
  // The RAW workspace retains this dirty draft; staging did not save or reset it.
  await page.getByRole('menuitem', { name: 'Change sets', exact: true }).click();
  controls.records.set('/routes/raw-staged', { id: 'raw-staged', ...original, desc: 'Edited elsewhere' });
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click();
  await expect(page.getByText(/The destination changed since this draft was staged/)).toBeVisible(); expect(controls.writes).toEqual([]);
});


test('re-preview continues untouched items after a failed prerequisite without replaying success', async ({ page }) => {
  const controls = await setup(page); controls.failOnceAfterWrite.add('/services/service-canary'); await stage(page);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click(); await apply(page, 3);
  await expect(page.getByText('Execution stopped. Remaining items were not applied.', { exact: true })).toBeVisible();
  expect(controls.writes).toEqual(['/upstreams/upstream-canary']);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply 2 changes', exact: true })).toBeEnabled();
  await apply(page, 2); await expect(page.getByText('3 staged · 3 verified', { exact: true })).toBeVisible();
  expect(controls.writes).toEqual(['/upstreams/upstream-canary', '/services/service-canary', '/routes/route-canary']);
});

test('preview retains its accessible name while busy and after the destinations are ready', async ({ page }) => {
  const controls = await setup(page); await stage(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let held = false;
  await page.route('**/apisix/admin/upstreams/upstream-canary', async (route) => {
    if (!held && route.request().method() === 'GET') { held = true; await pending; }
    await route.fallback();
  });
  const preview = page.getByRole('button', { name: 'Preview destinations', exact: true });
  await preview.click();
  try {
    await expect(preview).toHaveAttribute('aria-busy', 'true');
    await expect(preview).toHaveClass(/ant-btn-loading/);
    await expect(page.getByRole('button', { name: /^Apply.*changes$/ })).toBeDisabled();
    expect(controls.writes).toEqual([]);
  } finally { release(); }
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveClass(/ant-btn-loading/);
  await expect(page.getByRole('button', { name: 'Apply 3 changes', exact: true })).toBeEnabled();
  await preview.click();
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Apply 3 changes', exact: true })).toBeEnabled();
  expect(controls.writes).toEqual([]);
});


test('staged drafts survive navigation and retain browser unload protection outside the workspace', async ({ page }) => {
  const controls = await setup(page); await stage(page);
  await page.getByRole('menuitem', { name: 'Plugin inventory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plugin inventory', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Plugin inventory', exact: true })).toHaveClass(/ant-menu-item-selected/);
  await expect(page.getByRole('menuitem', { name: 'Change sets', exact: true })).not.toHaveClass(/ant-menu-item-selected/);
  await page.getByRole('menuitem', { name: 'Import / Export', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import / Export', exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(true);
  await page.getByRole('menuitem', { name: 'Change sets', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Change sets', exact: true })).toHaveClass(/ant-menu-item-selected/);
  await expect(page.getByRole('menuitem', { name: 'Plugin inventory', exact: true })).not.toHaveClass(/ant-menu-item-selected/);
  await expect(page.getByText('3 staged · 0 verified', { exact: true })).toBeVisible(); expect(controls.writes).toEqual([]);
});
