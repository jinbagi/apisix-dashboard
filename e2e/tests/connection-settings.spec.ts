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

const activeKey = 'fixture-active-key';
const replacementKey = 'fixture-replacement-key';
const storedKey = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('settings:adminKey') ?? 'null'));

async function mockConnection(page: Page, initialKey?: string) {
  if (initialKey) await page.addInitScript((key) => localStorage.setItem('settings:adminKey', JSON.stringify(key)), initialKey);
  const state = { requests: [] as { key?: string; method: string; test: boolean }[], response: undefined as unknown, pause: undefined as Promise<void> | undefined };
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = request.headers()['x-api-key'];
    const isTest = url.pathname.endsWith('/routes') && url.searchParams.get('page_size') === '1';
    state.requests.push({ key, method: request.method(), test: isTest });
    if (isTest && state.pause) await state.pause;
    if (isTest && state.response !== undefined) {
      if (typeof state.response === 'string') return route.fulfill({ contentType: 'text/html', body: state.response });
      return route.fulfill({ json: state.response });
    }
    if (key !== activeKey && key !== replacementKey) {
      await route.fulfill({ status: 401, json: { error_msg: 'fixture: invalid key' } });
      return;
    }
    if (url.pathname.endsWith('/plugins')) return route.fulfill({ json: {} });
    await route.fulfill({ json: { total: 0, list: [] } });
  });
  return state;
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  return page.getByRole('dialog', { name: 'Connection settings', exact: true });
}

test('first setup keeps the key in a draft until its explicit test succeeds', async ({ page }, testInfo) => {
  const state = await mockConnection(page);
  await page.goto('routes');
  const dialog = page.getByRole('dialog', { name: 'Welcome to APISIX Dashboard' });
  const input = dialog.getByRole('textbox', { name: 'Admin Key', exact: true });
  await expect(input).toBeFocused();
  await input.fill('fixture-invalid-key');
  expect(await storedKey(page)).toBeNull();
  expect(state.requests).toEqual([]);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Test connection' }).click();
  await expect(dialog.getByText('Authentication failed - the Admin Key is incorrect')).toBeVisible();
  expect(await storedKey(page)).toBeNull();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveAccessibleDescription(/Use the X-API-KEY.*Authentication failed/);
  await page.reload();
  await expect(input).toBeEmpty();
  await input.fill(replacementKey);
  let release!: () => void;
  state.pause = new Promise<void>((resolve) => { release = resolve; });
  await dialog.getByRole('button', { name: 'Test connection' }).click();
  await expect(input).toBeDisabled();
  expect(await storedKey(page)).toBeNull();
  release();
  await expect(dialog.getByText('Connected successfully', { exact: true })).toBeVisible();
  expect(await storedKey(page)).toBe(replacementKey);
  await expect(input).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  await expect(dialog.getByText('UI Commit SHA')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('connection-verified.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Continue to dashboard' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Routes', exact: true })).toBeVisible();
  expect(state.requests.every(({ method }) => method === 'GET')).toBe(true);
});

test('failed edits and cancellation preserve the previous active key', async ({ page }) => {
  const state = await mockConnection(page, activeKey);
  await page.goto('routes');
  const dialog = await openSettings(page);
  const input = dialog.getByRole('textbox', { name: 'Admin Key', exact: true });
  await input.fill('fixture-invalid-key');
  expect(await storedKey(page)).toBe(activeKey);
  await dialog.getByRole('button', { name: 'Test connection' }).click();
  await expect(dialog.getByText('Your previous active key has not changed.')).toBeVisible();
  expect(await storedKey(page)).toBe(activeKey);
  expect(state.requests.filter(({ key }) => key === 'fixture-invalid-key')).toEqual([
    { key: 'fixture-invalid-key', method: 'GET', test: true },
  ]);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await openSettings(page);
  await expect(input).toHaveValue(activeKey);
  await input.fill(replacementKey);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await storedKey(page)).toBe(activeKey);
});

test('cancelling an in-flight test cannot adopt its late successful response', async ({ page }) => {
  const state = await mockConnection(page, activeKey);
  await page.goto('routes');
  const dialog = await openSettings(page);
  await dialog.getByRole('textbox', { name: 'Admin Key', exact: true }).fill(replacementKey);
  let release!: () => void;
  state.pause = new Promise<void>((resolve) => { release = resolve; });
  await dialog.getByRole('button', { name: 'Test connection' }).click();
  await expect.poll(() => state.requests.some(({ test }) => test)).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  release();
  await expect(dialog).toBeHidden();
  await openSettings(page);
  await expect(dialog.getByRole('textbox', { name: 'Admin Key', exact: true })).toHaveValue(activeKey);
  expect(await storedKey(page)).toBe(activeKey);
});

test('empty key errors are linked and the modal keeps keyboard focus', async ({ page }) => {
  const state = await mockConnection(page);
  await page.goto('routes');
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox', { name: 'Admin Key', exact: true });
  await dialog.getByRole('button', { name: 'Test connection' }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-required', 'true');
  await expect(input).toHaveAccessibleDescription(/Please enter an Admin Key first/);
  expect(state.requests).toEqual([]);
  await input.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Show', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Test connection' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
});

for (const width of [320, 390, 827]) {
  test(`connection and error layouts fit a ${width}px viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mockConnection(page);
    await page.goto('routes');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Test connection' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath('connection-' + width + '.png'), animations: 'disabled' });
  });
}



test('HTTP 200 HTML or malformed data never verifies or replaces the active key', async ({ page }) => {
  const state = await mockConnection(page, activeKey);
  await page.goto('routes');
  const dialog = await openSettings(page);
  await dialog.getByRole('textbox', { name: 'Admin Key', exact: true }).fill(replacementKey);
  for (const response of ['<html><body>SPA fallback</body></html>', { list: [], total: -1 }, { list: {}, total: 4 }, { list: [null], total: 1 }]) {
    state.response = response;
    await dialog.getByRole('button', { name: 'Test connection' }).click();
    await expect(dialog.getByText('APISIX did not return a valid Routes list. Check the Admin API endpoint.')).toBeVisible();
    expect(await storedKey(page)).toBe(activeKey);
  }
  state.response = { list: {}, total: 0 };
  await dialog.getByRole('button', { name: 'Test connection' }).click();
  await expect(dialog.getByText('Connected successfully', { exact: true })).toBeVisible();
  expect(await storedKey(page)).toBe(replacementKey);
});
