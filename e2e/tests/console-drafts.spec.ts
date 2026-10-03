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

async function setup(page: Page, options: { fail?: boolean; storageFails?: boolean } = {}) {
  const writes: string[] = [];
  await page.addInitScript(({ storageFails }) => {
    localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key'));
    if (storageFails) {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('api-console:')) throw new DOMException('Storage full', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    }
  }, options);
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    if (request.method() !== 'GET') writes.push(path);
    if (path === '/routes/draft') return route.fulfill({
      status: options.fail ? 503 : 200,
      json: options.fail ? { error_msg: 'Unavailable' } : { value: { id: 'draft', uri: '/loaded', desc: 'Server value' } },
    });
    if (path === '/plugins') return route.fulfill({ json: {} });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('raw_api');
  await expect(page.getByText('No unsent changes', { exact: true })).toBeVisible();
  return writes;
}

async function fillDraft(page: Page, body = '{"uri":"/my-draft"}') {
  await page.getByRole('combobox', { name: /Path suffix/ }).fill('draft');
  await uiFillMonacoEditor(page, page.locator('.monaco-editor').first(), body);
  await expect(page.getByText('Unsent changes', { exact: true })).toBeVisible();
}

async function choose(page: Page, label: string, value: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}

test('invalid Console JSON survives sidebar navigation and browser Back until discard', async ({ page }, testInfo) => {
  const writes = await setup(page);
  await page.getByRole('menuitem', { name: 'Routes', exact: true }).click();
  await page.getByRole('menuitem', { name: 'API Console', exact: true }).click();
  await fillDraft(page, '{invalid');
  await page.getByRole('menuitem', { name: 'Routes', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Leave API Console?' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toHaveCSS('transform', 'none');
  await page.screenshot({ path: testInfo.outputPath('console-draft-protection.png'), animations: 'disabled' });
  await confirmation.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.locator('.monaco-editor').first()).toContainText('{invalid');
  await page.goBack();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page.getByRole('heading', { name: 'Routes', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

for (const [label, value] of [['Method', 'PATCH'], ['Resource', 'Services']]) {
  test(`${label} replacement preserves a custom Console body on cancel`, async ({ page }) => {
    const writes = await setup(page);
    await fillDraft(page);
    await choose(page, label, value);
    const confirmation = page.getByRole('dialog', { name: 'Replace request draft?' });
    await expect(confirmation).toBeVisible();
    await page.keyboard.press('Control+Enter');
    expect(writes).toEqual([]);
    await confirmation.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.locator('.monaco-editor').first()).toContainText('/my-draft');
    await choose(page, label, value);
    await confirmation.getByRole('button', { name: 'Discard and replace' }).click();
    await expect(page.locator('.monaco-editor').first()).not.toContainText('/my-draft');
    expect(writes).toEqual([]);
  });
}

test('loading an existing resource requires consent only when replacing edited JSON', async ({ page }) => {
  await setup(page);
  await fillDraft(page);
  await page.getByRole('button', { name: 'Load resource' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Replace request draft?' });
  await confirmation.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.locator('.monaco-editor').first()).toContainText('/my-draft');
  await page.getByRole('button', { name: 'Load resource' }).click();
  await confirmation.getByRole('button', { name: 'Discard and replace' }).click();
  await expect(page.locator('.monaco-editor').first()).toContainText('/loaded');
  await expect(page.getByText('No unsent changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Format Request JSON', exact: true }).click();
  await expect(page.getByText('No unsent changes', { exact: true })).toBeVisible();
});

test('successful requests and stored presets clear the guard, while later edits stay protected', async ({ page }) => {
  await setup(page);
  await choose(page, 'Method', 'GET');
  await page.getByRole('combobox', { name: /Path suffix/ }).fill('draft');
  await page.getByRole('button', { name: /Send GET/ }).click();
  await expect(page.getByText('No unsent changes', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Query parameters' }).fill('page=2');
  await expect(page.getByText('Unsent changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  const preset = page.getByRole('dialog', { name: 'Save session preset' });
  await preset.getByRole('textbox').fill('Saved draft');
  await preset.getByRole('button', { name: 'Save preset' }).click();
  await expect(page.getByText('No unsent changes', { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Routes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Routes', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Leave API Console?' })).toBeHidden();
});

test('failed requests remain protected and a failed preset save cannot mark a draft clean', async ({ page }) => {
  await setup(page, { fail: true, storageFails: true });
  await choose(page, 'Method', 'GET');
  await page.getByRole('combobox', { name: /Path suffix/ }).fill('draft');
  await page.getByRole('button', { name: /Send GET/ }).click();
  await expect(page.getByText('Request failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Unsent changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  const preset = page.getByRole('dialog', { name: 'Save session preset' });
  await preset.getByRole('textbox').fill('Cannot store');
  await preset.getByRole('button', { name: 'Save preset' }).click();
  await expect(page.getByText('Could not save the preset. Your request draft is still available.')).toBeVisible();
  await preset.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Routes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Leave API Console?' })).toBeVisible();
});

test('browser reload warns about an unsent request and cancelling preserves it', async ({ page }) => {
  await setup(page);
  await fillDraft(page);
  const dialogEvent = page.waitForEvent('dialog');
  await page.evaluate(() => { setTimeout(() => window.location.reload(), 0); });
  const dialog = await dialogEvent;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(page.locator('.monaco-editor').first()).toContainText('/my-draft');
});

test('in-flight requests lock replacement controls and keep navigation blocked until the response', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/apisix/admin/routes/draft', async (route) => {
    await pending;
    await route.fulfill({ json: { value: { id: 'draft', uri: '/done' } } });
  });
  await choose(page, 'Method', 'GET');
  await page.getByRole('combobox', { name: /Path suffix/ }).fill('draft');
  await page.getByRole('button', { name: /Send GET/ }).click();
  await expect(page.getByText('Request in progress', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Method' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Query parameters' })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Routes', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Leave API Console?' });
  await expect(confirmation.getByRole('button', { name: 'Discard and leave' })).toBeDisabled();
  release();
  await expect(page.getByText('No unsent changes', { exact: true })).toBeVisible();
  await confirmation.getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page.getByRole('heading', { name: 'Routes', exact: true })).toBeVisible();
});
