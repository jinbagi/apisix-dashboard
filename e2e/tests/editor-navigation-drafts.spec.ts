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

async function mockApi(page: Page) {
  let value: Record<string, unknown> = { id: 'draft', uri: '/draft', desc: 'Saved description', create_time: 1, update_time: 1 };
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path === '/routes/draft' || (path === '/routes' && request.method() === 'POST')) {
      if (['PUT', 'PATCH', 'POST'].includes(request.method())) {
        writes.push(request.postDataJSON());
        value = { ...value, ...request.postDataJSON(), update_time: Number(value.update_time) + 1 };
      }
      response = { value };
    } else if (path === '/routes') response = { list: [{ value }], total: 1 };
    else if (path === '/plugins/list') response = [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  return writes;
}

async function editJson(page: Page, tab: string, text: string) {
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: tab }).locator('.monaco-editor').first()).toBeVisible();
  await page.evaluate((value) => window.__monacoEditor__?.setValue(value), text);
}

const leaveDialog = (page: Page) => page.getByRole('dialog', { name: 'Leave without saving?' });

test('sidebar navigation preserves a form draft until explicitly discarded', async ({ page }) => {
  const writes = await mockApi(page);
  await page.goto('routes/detail/draft');
  await page.getByLabel('Description', { exact: true }).fill('Unsaved change that should survive navigation');
  await page.getByRole('menuitem', { name: 'Services', exact: true }).click();
  await expect(leaveDialog(page)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-leave-confirmation.png'), animations: 'disabled' });
  await leaveDialog(page).getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Unsaved change that should survive navigation');
  await expect(page).toHaveURL(/routes\/detail\/draft$/);
  await page.screenshot({ path: test.info().outputPath('02-draft-preserved.png'), animations: 'disabled' });
  await page.getByRole('menuitem', { name: 'Services', exact: true }).click();
  await leaveDialog(page).getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page.getByRole('heading', { name: 'Services', exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
});

test('Cancel and browser back protect incomplete Payload JSON', async ({ page }) => {
  await mockApi(page);
  await page.goto('routes');
  await page.getByRole('link', { name: 'draft', exact: true }).click();
  await editJson(page, 'Payload JSON', '{');
  await page.getByRole('tabpanel', { name: 'Payload JSON' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(leaveDialog(page)).toBeVisible();
  await leaveDialog(page).getByRole('button', { name: 'Keep editing' }).click();
  expect(await page.evaluate(() => window.__monacoEditor__?.getValue())).toBe('{');
  await page.goBack();
  await expect(leaveDialog(page)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('03-json-protected.png'), animations: 'disabled' });
  await leaveDialog(page).getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page.getByRole('heading', { name: 'Routes', exact: true })).toBeVisible();
});

test('independent Admin API JSON is protected on navigation', async ({ page }) => {
  await mockApi(page);
  await page.goto('routes/detail/draft');
  await editJson(page, 'Admin API JSON', '{"uri":"/draft","desc":"raw draft"}');
  await page.getByRole('menuitem', { name: 'Services', exact: true }).click();
  await expect(leaveDialog(page)).toBeVisible();
  await leaveDialog(page).getByRole('button', { name: 'Keep editing' }).click();
  expect(await page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('raw draft');
});

test('refresh asks before losing a draft and cancel retains it', async ({ page }) => {
  await mockApi(page);
  await page.goto('routes/detail/draft');
  await page.getByLabel('Description', { exact: true }).fill('Keep after canceled refresh');
  const dialogPromise = page.waitForEvent('dialog');
  await page.evaluate(() => { setTimeout(() => window.location.reload(), 0); });
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Keep after canceled refresh');
});

test('a saved form and an unchanged form can leave without a warning', async ({ page }) => {
  await mockApi(page);
  await page.goto('routes/detail/draft');
  await page.getByLabel('Description', { exact: true }).fill('Saved edit');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
  await expect(page.getByText('No pending changes', { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Services', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Services', exact: true })).toBeVisible();
  await page.goto('routes/detail/draft');
  await page.getByRole('menuitem', { name: 'Services', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Services', exact: true })).toBeVisible();
});

test('successful creation navigates to the saved resource', async ({ page }) => {
  await mockApi(page);
  await page.goto('routes/add');
  await page.getByRole('textbox', { name: 'URI', exact: true }).fill('/created');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(/routes\/detail\/draft$/);
  await expect(page.getByRole('textbox', { name: 'URI', exact: true })).toHaveValue('/created');
  await expect(leaveDialog(page)).toBeHidden();
});

test('confirmed deletion leaves without a second draft warning', async ({ page }) => {
  await mockApi(page);
  await page.goto('routes/detail/draft');
  await page.getByLabel('Description', { exact: true }).fill('Discarded by deletion');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete Route' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Routes', exact: true })).toBeVisible();
  await expect(leaveDialog(page)).toBeHidden();
});
