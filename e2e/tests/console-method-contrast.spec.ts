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
import { expect, type Locator, type Page, test, type TestInfo } from '@playwright/test';

const methods = ['GET', 'PUT', 'PATCH', 'POST', 'DELETE'] as const;
const history = methods.map(method => ({ id: method, method, resource: '/routes', pathSuffix: 'contrast', queryString: '',
  body: '{"uri":"/contrast"}', endpoint: '/routes/contrast', status: 200, time: 4, createdAt: 1 }));
async function setup(page: Page, theme: 'light' | 'dark', url: string, width?: number) {
  if (width) await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript(({ theme, history }) => {
    localStorage.setItem('theme', JSON.stringify(theme));
    localStorage.setItem('settings:adminKey', JSON.stringify('contrast-fixture'));
    sessionStorage.setItem('api-console:session-history', JSON.stringify(history));
  }, { theme, history });
  const unexpected: string[] = [];
  await page.route('**/*', route => {
    const request = route.request(), target = new URL(request.url());
    if (target.origin !== new URL(url).origin) { unexpected.push(request.url()); return route.abort(); }
    if (!target.pathname.startsWith('/apisix/admin/')) return route.continue();
    if (request.method() !== 'GET') { unexpected.push(request.method() + target.pathname); return route.abort(); }
    const path = target.pathname.replace('/apisix/admin', '');
    return route.fulfill({ json: path === '/plugins/list' ? [] : path.startsWith('/plugins') ? {} : { list: [], total: 0 } });
  });
  await page.goto(url + 'raw_api');
  await expect(page.getByRole('button', { name: 'Variables', exact: true })).toBeVisible();
  return unexpected;
}
async function choose(page: Page, method: string) {
  await page.locator('[class*="methodSelect"]').click();
  await page.getByRole('option', { name: method, exact: true }).click();
  await page.getByRole('combobox', { name: /Path suffix/ }).fill('contrast');
  await settledLayout(page);
  return page.getByRole('button', { name: `Send ${method}`, exact: false });
}
async function readable(locator: Locator) {
  await expect(locator).toBeVisible();
  const measurement = await textContrast(locator);
  expect(measurement.ratio, JSON.stringify(measurement)).toBeGreaterThanOrEqual(4.5);
  return measurement;
}
async function sendStates(page: Page, send: Locator) {
  const result = [];
  await send.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0);
  for (const state of ['default', 'hover', 'active', 'focus']) {
    if (state === 'hover') await send.hover();
    if (state === 'active') { await page.mouse.down(); expect(await send.evaluate(el => el.matches(':active'))).toBe(true); }
    if (state === 'focus') { await page.mouse.move(0, 0); await page.mouse.up(); await page.keyboard.press('Tab'); await send.focus(); }
    await settledLayout(page);
    const label = await readable(send), shortcut = await readable(send.locator('[class*="shortcut"]'));
    if (state === 'focus') expect(label.focusVisible).toBe(true);
    result.push({ state, label, shortcut });
  }
  return result;
}
async function labelStates(page: Page, control: Locator, label: Locator, focusTarget = control, select = false) {
  const result = [];
  await control.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0);
  for (const state of ['default', 'hover', 'active', 'focus']) {
    if (state === 'hover') await control.hover();
    if (state === 'active') { await page.mouse.down(); expect(await control.evaluate(el => el.matches(':active'))).toBe(true); }
    if (state === 'focus') {
      await page.mouse.move(0, 0); await page.mouse.up();
      if (select) await page.keyboard.press('Escape');
      await page.keyboard.press('Tab'); await focusTarget.focus();
      expect(await focusTarget.evaluate(el => el.matches(':focus-visible'))).toBe(true);
    }
    await settledLayout(page);
    result.push({ state, label: await readable(label) });
  }
  return result;
}
async function desktopCapture(page: Page, info: TestInfo, theme: string, method: string) {
  if (method === 'PUT') await page.screenshot({ path: info.outputPath(`${theme}-desktop.png`), animations: 'disabled', fullPage: true });
}
async function compactCase(standard: Page, baseURL: string, info: TestInfo, theme: 'light' | 'dark', size: 390 | 'native200') {
    const native = size === 'native200' ? await nativeZoomContext() : undefined;
    const page = native ? await native.context.newPage() : standard;
    try {
      const unexpected = await setup(page, theme, baseURL!, size === 390 ? 390 : undefined);
      const zoom = native ? await setNativeZoom(page, native.worker, native.initialDpr) : undefined;
      const send = await choose(page, 'PUT');
      const states = await sendStates(page, send);
      await expect(send).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Enter');
      const review = page.getByRole('dialog', { name: 'PUT /routes/contrast', exact: true });
      await expect(review).toBeVisible();
      await review.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(review).toBeHidden();
      await expect(send).toBeFocused();
      const geometry = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
      await send.scrollIntoViewIfNeeded();
      const surface = native ? await captureNativeViewport(page, info.outputPath(`${theme}-${size}.png`))
        : await page.screenshot({ path: info.outputPath(`${theme}-${size}.png`), animations: 'disabled' }).then(() => undefined);
      await writeFile(info.outputPath('measurements.json'), JSON.stringify({ theme, size, zoom, states, geometry, surface }, null, 2));
      return unexpected;
    } finally { await native?.close(); }
}
for (const theme of ['light', 'dark'] as const) {
  test(`${theme} Console method colors stay readable in every enabled state`, async ({ page, baseURL }, info) => {
    const unexpected = await setup(page, theme, baseURL!, 1440);
    const records = [];
    for (const method of methods) {
      const send = await choose(page, method);
      const selection = page.locator('[class*="methodSelect"] span[style*="color"]');
      const selected = await readable(selection);
      const selectionStates = await labelStates(page, page.locator('[class*="methodSelect"]'), selection, page.locator('[class*="methodSelect"] input'), true);
      const summary = await readable(page.locator('[class*="methodTag"]'));
      records.push({ method, selected, selectionStates, summary, send: await sendStates(page, send) });
      await desktopCapture(page, info, theme, method);
    }
    // Distinct, text-labeled methods remain distinguishable without relying on color alone.
    expect(new Set(records.map(record => record.selected.color)).size).toBe(5);
    await page.getByRole('button', { name: 'History (5)', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Request history' });
    await expect(drawer).toBeVisible(); await settledLayout(page);
    const badges = [];
    for (const method of methods) {
      const tag = drawer.locator('.ant-tag').filter({ hasText: new RegExp(`^${method}$`) });
      badges.push({ method, states: await labelStates(page, tag.locator('xpath=ancestor::button'), tag) });
    }
    await page.screenshot({ path: info.outputPath(`${theme}-history.png`), animations: 'disabled' });
    await writeFile(info.outputPath('measurements.json'), JSON.stringify({ theme, records, badges }, null, 2));
    expect(unexpected).toEqual([]);
  });

  for (const size of [390, 'native200'] as const) test(`${theme} Console method actions remain visible at ${size}`, async ({ page: standard, baseURL }, info) => {
    expect(await compactCase(standard, baseURL!, info, theme, size)).toEqual([]);
  });
}

for (const theme of ['light', 'dark'] as const) test(`${theme} Console disabled and loading colors and request gates are preserved`, async ({ page, baseURL }, info) => {
  const unexpected = await setup(page, theme, baseURL!, 1440);
  const sendPut = page.getByRole('button', { name: 'Send PUT', exact: false });
  await expect(sendPut).toBeDisabled();
  await expect(sendPut).toHaveCSS('background-color', 'rgb(250, 173, 20)');
  await expect(sendPut).toHaveCSS('color', theme === 'light' ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.25)');
  await expect(sendPut.locator('[class*="shortcut"]')).toHaveCSS('opacity', '0.72');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reads: { path: string; method: string }[] = [];
  await page.route('**/apisix/admin/routes/contrast', async route => {
    reads.push({ path: new URL(route.request().url()).pathname, method: route.request().method() });
    await gate;
    await route.fulfill({ json: { value: { id: 'contrast', uri: '/contrast' } } });
  });
  const sendGet = await choose(page, 'GET');
  await sendGet.click();
  try {
    await expect(sendGet).toHaveClass(/ant-btn-loading/);
    await expect(page.locator('[class*="methodSelect"] input')).toBeDisabled();
    await expect(page.locator('[class*="methodSelect"] span[style*="color"]')).toHaveCSS('color', 'rgb(19, 194, 194)');
    await expect(sendGet).toHaveCSS('background-color', 'rgb(19, 194, 194)');
    await expect(sendGet).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(sendGet.locator('[class*="shortcut"]')).toHaveCSS('opacity', '0.72');
    await page.keyboard.press('Control+Enter');
    expect(reads).toEqual([{ path: '/apisix/admin/routes/contrast', method: 'GET' }]);
    await page.screenshot({ path: info.outputPath(`${theme}-held-loading.png`), animations: 'disabled' });
  } finally { release(); }
  await expect(sendGet).not.toHaveClass(/ant-btn-loading/);
  await settledLayout(page); await readable(sendGet);
  await expect(page.getByRole('button', { name: 'History (6)', exact: true })).toBeVisible();
  // DELETE still requires explicit confirmation. Cancel sends nothing.
  const sendDelete = await choose(page, 'DELETE');
  await sendDelete.focus(); await page.keyboard.press('Enter');
  const confirmation = page.getByRole('dialog', { name: 'DELETE /routes/contrast', exact: true });
  await expect(confirmation.getByText('This will permanently delete the resource.')).toBeVisible();
  await expect(confirmation.getByRole('button', { name: 'Delete', exact: true })).toHaveClass(/ant-btn-dangerous/);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(unexpected).toEqual([]);
});
