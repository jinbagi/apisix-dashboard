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
import { writeFile } from 'node:fs/promises';

import { captureNativeViewport, nativeZoomContext, setNativeZoom, settledLayout } from '@e2e/utils/nativeBrowserZoom';
import { textContrast } from '@e2e/utils/textContrast';
import { expect, type Locator, type Page, test } from '@playwright/test';

const resource = { id: 'native-zoom', name: 'Native zoom API', uri: '/zoom/*', status: 1,
  upstream: { type: 'roundrobin', nodes: { 'fixture.example:8080': 1 } } };
const longId = `route-${'a'.repeat(58)}`;
const before = { id: longId, uri: '/before', labels: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`field_${i}`, 'Before'])), tail_marker: 'Before final field' };
const after = { ...before, uri: '/after', labels: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`field_${i}`, 'After'])), tail_marker: 'After final field' };

async function drawerOpacity(raw: Locator) {
  return raw.evaluate(element => {
    const panel = element.closest('.ant-drawer-content-wrapper');
    if (!panel) throw new Error('RAW drawer surface is missing');
    return getComputedStyle(panel).opacity;
  });
}

async function configureDrawerMotion(page: Page, slow: boolean) {
  if (slow) {
    // Widen the real Ant panel fade's final-frame race without changing opacity/colors.
    await page.addStyleTag({ content: '.ant-drawer-content-wrapper { transition-duration: 5s !important; }' });
  }
}

for (const { theme, slowDrawer } of [
  { theme: 'light', slowDrawer: false },
  { theme: 'dark', slowDrawer: false },
  { theme: 'dark', slowDrawer: true },
] as const) test(`native 200% browser zoom preserves table, RAW, Add and review actions in ${theme}${slowDrawer ? ' with a slow drawer transition' : ''}`, async ({ baseURL }, info) => {
  const fixture = await nativeZoomContext();
  const { context, worker, initialDpr } = fixture;
  const origin = new URL(baseURL!).origin;
  const writes: string[] = []; const external: string[] = [];
  const measurements: unknown[] = [];
  try {
    await context.addInitScript(theme => {
      localStorage.setItem('settings:adminKey', JSON.stringify('native-zoom-fixture-only'));
      localStorage.setItem('theme', JSON.stringify(theme));
      document.addEventListener('pointerdown', event => {
        const button = (event.target as Element).closest('button');
        document.documentElement.dataset.zoomPointer = button?.textContent?.trim() ?? '';
      }, true);
    }, theme);
    await context.route('**/*', route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== origin) { external.push(request.url()); return route.abort(); }
      if (!url.pathname.startsWith('/apisix/admin/')) return route.continue();
      if (request.method() !== 'GET') { writes.push(`${request.method()} ${url.pathname}`); return route.abort(); }
      const api = url.pathname.slice('/apisix/admin'.length);
      if (api === '/routes') return route.fulfill({ json: { list: [{ value: resource, key: '/apisix/routes/native-zoom' }], total: 1 } });
      if (api === '/routes/native-zoom') return route.fulfill({ json: { value: resource, key: '/apisix/routes/native-zoom' } });
      if (api === `/routes/${longId}`) return route.fulfill({ json: { value: before, key: `/apisix/routes/${longId}` } });
      if (/^\/routes\/[^/]+$/.test(api)) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
      if (api === '/plugins/list') return route.fulfill({ json: [] });
      if (api === '/plugins') return route.fulfill({ json: {} });
      return route.fulfill({ json: { list: [], total: 0 } });
    });
    const page = context.pages()[0];
    await page.goto(new URL('routes', baseURL).href);
    await expect(page.getByRole('link', { name: 'Native zoom API', exact: true })).toBeVisible();
    measurements.push({ flow: 'routes', ...await setNativeZoom(page, worker, initialDpr) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    measurements.push(await captureNativeViewport(page, info.outputPath(`${theme}-200-routes.png`)));
    const rawTrigger = page.getByRole('button', { name: 'Raw', exact: true }).first();
    await rawTrigger.scrollIntoViewIfNeeded(); await expect(rawTrigger).toBeInViewport({ ratio: 1 });
    measurements.push(await captureNativeViewport(page, info.outputPath(`${theme}-200-table-row.png`)));
    await configureDrawerMotion(page, slowDrawer);
    await rawTrigger.focus(); await page.keyboard.press('Enter');
    const raw = page.getByRole('dialog', { name: /Route: Native zoom API/ });
    await expect(raw.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
    const save = raw.getByRole('button', { name: 'Save Changes', exact: true }); await expect(save).toBeDisabled();
    await page.evaluate(() => { const editor = window.__monacoEditor__!; editor.setValue(JSON.stringify({ ...JSON.parse(editor.getValue()), desc: 'Unsaved native zoom draft' }, null, 2)); });
    await expect(save).toBeEnabled();
    const opacityBefore = await drawerOpacity(raw);
    // In-viewport buttons can precede the final opacity frame of the enclosing drawer.
    await settledLayout(page);
    await expect(save).toBeInViewport({ ratio: 1 });
    const opacityAfter = await drawerOpacity(raw);
    expect(opacityAfter).toBe('1');
    measurements.push({ flow: 'raw-drawer-opacity', before: opacityBefore, after: opacityAfter });
    const statusContrast = await textContrast(raw.getByText('Unsaved changes. Ctrl+S saves changed fields.', { exact: true }));
    expect(statusContrast.ratio, JSON.stringify(statusContrast)).toBeGreaterThanOrEqual(4.5);
    measurements.push({ flow: 'raw-dirty-status', ...statusContrast });
    await save.focus(); await page.keyboard.press('Tab'); await expect(save).not.toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    measurements.push(await captureNativeViewport(page, info.outputPath(`${theme}-200-raw.png`)));

    const addPage = await context.newPage(); await addPage.goto(new URL('routes/add', baseURL).href);
    await expect(addPage.getByRole('textbox', { name: 'ID', exact: true })).toBeVisible();
    measurements.push({ flow: 'add', ...await setNativeZoom(addPage, worker, initialDpr) });
    const id = addPage.getByRole('textbox', { name: 'ID', exact: true }); await id.focus(); await id.fill('native-zoom-created');
    await addPage.keyboard.press('Tab'); await expect(id).not.toBeFocused();
    await addPage.getByRole('textbox', { name: 'URI', exact: true }).fill('/native-zoom');
    const add = addPage.getByRole('button', { name: 'Add', exact: true }); await add.scrollIntoViewIfNeeded();
    await expect(add).toBeEnabled(); await expect(add).toBeInViewport({ ratio: 1 }); await add.focus(); await expect(add).toBeFocused();
    expect(await addPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    measurements.push(await captureNativeViewport(addPage, info.outputPath(`${theme}-200-add.png`)));

    const reviewPage = await context.newPage(); await reviewPage.goto(new URL('export_import', baseURL).href);
    await expect(reviewPage.getByRole('heading', { name: 'Import / Export', exact: true })).toBeVisible();
    measurements.push({ flow: 'review', ...await setNativeZoom(reviewPage, worker, initialDpr) });
    await reviewPage.locator('input[type="file"]').setInputFiles({ name: 'native-zoom.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 3, exportedAt: '2026-10-04T00:00:00Z', resources: { routes: [after] } })) });
    await reviewPage.getByRole('button', { name: 'Import Selected Resources', exact: true }).click();
    const parent = reviewPage.getByRole('dialog', { name: 'Confirm Import', exact: true });
    const trigger = parent.getByRole('button', { name: 'Compare JSON', exact: true }); await trigger.click();
    await expect(reviewPage.locator('html')).toHaveAttribute('data-zoom-pointer', 'Compare JSON');
    const review = reviewPage.getByRole('dialog', { name: 'Import JSON comparison', exact: true });
    await expect(review.locator('.monaco-diff-editor')).toBeVisible();
    await expect(review).not.toHaveClass(/ant-zoom-enter|ant-zoom-appear/);
    await reviewPage.evaluate(() => document.fonts.ready);
    const back = review.getByRole('button', { name: 'Back to import preview', exact: true });
    const keep = review.getByRole('button', { name: 'Keep editing', exact: true });
    for (const action of [back, keep]) await expect(action).toBeInViewport({ ratio: 1 });
    expect(await review.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await review.locator('.modified-in-monaco-diff-editor').getByRole('textbox').focus(); await reviewPage.keyboard.press('ControlOrMeta+End');
    await expect(review.locator('.modified-in-monaco-diff-editor .view-lines:not(.line-delete)')).toContainText('After final field');
    await expect(back).toBeInViewport({ ratio: 1 });
    measurements.push(await captureNativeViewport(reviewPage, info.outputPath(`${theme}-200-review.png`)));
    await keep.focus(); await reviewPage.keyboard.press('Enter'); await expect(review).toBeHidden(); await expect(trigger).toBeFocused();
    expect(writes).toEqual([]); expect(external).toEqual([]);
    await writeFile(info.outputPath(`${theme}-native-zoom.json`), JSON.stringify({ theme, build: process.env.E2E_BUILD_REF ?? 'test target', browserVersion: context.browser()?.version(), measurements, writes, external }, null, 2));
  } finally { await fixture.close(); }
});
