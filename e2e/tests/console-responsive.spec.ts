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
import { expect, type Locator, type Page, test, type TestInfo } from '@playwright/test';

async function setup(page: Page, url: string, theme: 'light' | 'dark', width?: number) {
  if (width) await page.setViewportSize({ width, height: 1000 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
  await page.addInitScript(theme => {
    localStorage.setItem('theme', JSON.stringify(theme));
    localStorage.setItem('settings:adminKey', JSON.stringify('console-layout-fixture'));
  }, theme);
  const controls = { fail: false, reads: 0, unexpected: [] as string[] };
  await page.route('**/*', route => {
    const request = route.request(), target = new URL(request.url());
    if (target.origin !== new URL(url).origin) { controls.unexpected.push(request.url()); return route.abort(); }
    if (!target.pathname.startsWith('/apisix/admin/')) return route.continue();
    if (request.method() !== 'GET') { controls.unexpected.push(request.method() + target.pathname); return route.abort(); }
    const path = target.pathname.replace('/apisix/admin', '');
    if (path === '/routes/geometry') {
      controls.reads++;
      return route.fulfill({ status: controls.fail ? 503 : 200, headers: { 'x-console-layout': 'fixture' },
        json: controls.fail ? { error_msg: 'Fixture unavailable' } : { key: '/apisix/routes/geometry', value: { id: 'geometry', uri: '/' } } });
    }
    return route.fulfill({ json: path === '/plugins/list' ? [] : path.startsWith('/plugins') ? {} : { list: [], total: 0 } });
  });
  await page.goto(url + 'raw_api');
  await expect(page.getByRole('button', { name: 'Variables', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: /Path suffix/ }).fill('geometry');
  await settledLayout(page);
  return controls;
}

/** Text ranges reveal clipped captions even when the page itself has no overflow. */
async function textGeometry(locator: Locator) {
  return locator.evaluate(element => {
    const bounds = (rect: DOMRect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    const box = bounds(element.getBoundingClientRect());
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const text = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.textContent ?? '';
      if (!value.trim()) continue;
      const range = document.createRange();
      range.setStart(node, value.search(/\S/)); range.setEnd(node, value.trimEnd().length);
      for (const rect of range.getClientRects()) if (rect.width && rect.height) text.push({ value: value.trim(), ...bounds(rect) });
    }
    return { box, text, contained: text.every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1) };
  });
}
async function checkedText(locator: Locator) {
  const result = await textGeometry(locator);
  expect.soft(result.text.length).toBeGreaterThan(0);
  expect.soft(result.contained, JSON.stringify(result)).toBe(true);
  return result;
}
async function headerGeometry(header: Locator) {
  await header.scrollIntoViewIfNeeded();
  const title = await checkedText(header.locator('.ant-card-head-title'));
  const extra = await checkedText(header.locator('.ant-card-extra'));
  const separated = title.box.right <= extra.box.left + 1 || extra.box.right <= title.box.left + 1 || title.box.bottom <= extra.box.top + 1 || extra.box.bottom <= title.box.top + 1;
  expect.soft(separated, JSON.stringify({ title, extra })).toBe(true);
  const caption = await checkedText(header);
  const actions = [];
  for (const button of await header.getByRole('button').all()) actions.push(await checkedText(button));
  return { title, extra, caption, actions };
}
async function capture(page: Page, info: TestInfo, name: string, native: boolean) {
  await settledLayout(page);
  if (native) return captureNativeViewport(page, info.outputPath(name + '.png'));
  await page.screenshot({ path: info.outputPath(name + '.png'), animations: 'disabled' });
}
async function exercise(standard: Page, baseURL: string, info: TestInfo, theme: 'light' | 'dark', size: 320 | 390 | 1440 | 'native200') {
  const native = size === 'native200' ? await nativeZoomContext() : undefined;
  const page = native ? await native.context.newPage() : standard;
  const measurements: Record<string, unknown> = { theme, size };
  try {
    const controls = await setup(page, baseURL, theme, typeof size === 'number' ? size : undefined);
    measurements.zoom = native ? await setNativeZoom(page, native.worker, native.initialDpr) : undefined;
    const send = page.getByRole('button', { name: /Send PUT/ });
    await send.scrollIntoViewIfNeeded(); await settledLayout(page);
    measurements.send = await checkedText(send);
    measurements.shortcut = await checkedText(send.locator('[class*="shortcut"]'));
    measurements.load = await checkedText(page.getByRole('button', { name: 'Load resource', exact: true }));
    await capture(page, info, `${theme}-${size}-actions`, !!native);
    await send.focus(); await page.keyboard.press('Enter');
    const review = page.getByRole('dialog', { name: 'PUT /routes/geometry', exact: true });
    await expect(review).toBeVisible(); await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(review).toBeHidden(); await expect(send).toBeFocused();
    const request = page.locator('[class*="workspaceCard"]').filter({ has: page.locator('[class*="panelTitle"]') }).locator('.ant-card-head');
    await settledLayout(page); measurements.request = await headerGeometry(request);
    const format = request.getByRole('button', { name: 'Format Request JSON', exact: true });
    await format.focus(); await page.keyboard.press('Enter');
    await expect(page.getByText('Request JSON formatted', { exact: true })).toBeVisible();
    await expect(page.locator('.ant-message-notice')).toHaveCount(0);
    await request.scrollIntoViewIfNeeded(); await capture(page, info, `${theme}-${size}-request`, !!native);
    await page.locator('[class*="methodSelect"]').click(); await page.getByRole('option', { name: 'GET', exact: true }).click();
    const get = page.getByRole('button', { name: /Send GET/ });
    await get.click();
    const response = page.locator('[class*="workspaceCard"]').filter({ has: page.locator('[class*="responseTitle"]') }).locator('.ant-card-head');
    await expect(response.locator('.ant-tag')).toHaveText('200'); await settledLayout(page);
    measurements.success = await headerGeometry(response);
    await response.getByText('Headers', { exact: true }).click();
    await expect(response.getByText('Response Headers', { exact: true })).toBeVisible(); await settledLayout(page);
    measurements.headers = await headerGeometry(response);
    await response.getByRole('button', { name: 'Copy headers', exact: true }).click();
    await expect(page.getByText('Copied', { exact: true })).toBeVisible();
    await expect(page.locator('.ant-message-notice')).toHaveCount(0);
    await capture(page, info, `${theme}-${size}-response`, !!native);
    await response.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.getByText('Ready for a request', { exact: true })).toBeVisible();
    controls.fail = true; await get.click();
    await expect(response.locator('.ant-tag')).toHaveText('503'); await settledLayout(page);
    measurements.error = await headerGeometry(response);
    await capture(page, info, `${theme}-${size}-error`, !!native);
    controls.fail = false; await response.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(response.locator('.ant-tag')).toHaveText('200');
    controls.fail = true; await get.click(); await expect(response.locator('.ant-tag')).toHaveText('503');
    await response.getByRole('button', { name: 'Restore request', exact: true }).click();
    await expect(page.getByRole('combobox', { name: /Path suffix/ })).toHaveValue('geometry');
    await expect(page.getByText('Ready for a request', { exact: true })).toBeVisible();
    expect(controls.reads).toBe(4);
    measurements.page = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    const geometry = measurements.page as { client: number; scroll: number };
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    return controls.unexpected;
  } finally {
    await writeFile(info.outputPath('geometry.json'), JSON.stringify(measurements, null, 2));
    await native?.close();
  }
}
for (const theme of ['light', 'dark'] as const) for (const size of [320, 390, 1440, 'native200'] as const) {
  test(`${theme} Console captions and response actions fit at ${size}`, async ({ page, baseURL }, info) => {
    test.setTimeout(60_000);
    expect(await exercise(page, baseURL!, info, theme, size)).toEqual([]);
  });
}
