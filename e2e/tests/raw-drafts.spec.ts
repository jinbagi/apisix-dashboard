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

const initial = { id: 'draft-route', name: 'Draft route', uri: '/draft/*', desc: 'Before', upstream: { nodes: { '127.0.0.1:1980': 1 } }, create_time: 1, update_time: 1 };
const editable = { name: initial.name, uri: initial.uri, desc: initial.desc, upstream: initial.upstream };
const password = 'example-draft-password';
const key = 'raw-draft:v1:%2Froutes%2Fdraft-route';

async function setup(page: Page) {
  const controls = { value: { ...initial }, failRead: false, writes: [] as unknown[] };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/apisix/admin', '');
    if (path === '/routes/draft-route') {
      if (controls.failRead) return route.fulfill({ status: 503, json: { error_msg: 'Unavailable' } });
      if (route.request().method() === 'PATCH') {
        controls.writes.push(route.request().postDataJSON());
        controls.value = { ...controls.value, ...route.request().postDataJSON() };
      }
      return route.fulfill({ json: { value: controls.value } });
    }
    if (path === '/routes') return route.fulfill({ json: { list: [{ value: controls.value }], total: 1 } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('routes');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  return controls;
}
const drawer = (page: Page) => page.getByRole('dialog', { name: /Route: Draft route/ });
const vault = (page: Page) => page.getByRole('dialog', { name: 'Local RAW draft', exact: true });
async function store(page: Page, text = JSON.stringify({ ...editable, desc: 'Private draft token-123' })) {
  await uiFillMonacoEditor(page, drawer(page).locator('.monaco-editor'), text);
  await drawer(page).getByRole('button', { name: 'Drafts', exact: true }).click();
  await vault(page).getByRole('textbox', { name: 'Draft password', exact: true }).fill(password);
  await vault(page).getByRole('textbox', { name: 'Confirm draft password', exact: true }).fill(password);
  await vault(page).getByRole('button', { name: 'Save encrypted draft', exact: true }).click();
  await expect(vault(page).getByText(/Encrypted draft saved on this browser/)).toBeVisible();
}
async function unlock(page: Page, secret = password) {
  await vault(page).getByRole('textbox', { name: 'Draft password', exact: true }).fill(secret);
  await vault(page).getByRole('button', { name: 'Unlock and compare', exact: true }).click();
}
async function closeVault(page: Page) {
  await vault(page).getByRole('button', { name: 'Close', exact: true }).last().click();
}

test('encrypted drafts survive reopening, compare latest state, and keep concurrent changes protected', async ({ page }) => {
  const controls = await setup(page);
  await store(page);
  await page.screenshot({ path: test.info().outputPath('vault.png') });
  const encoded = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  expect(encoded).toBeTruthy();
  expect(encoded).not.toContain('Private draft');
  expect(encoded).not.toContain('token-123');
  expect(encoded).not.toContain(password);
  expect(controls.writes).toEqual([]);
  await closeVault(page);
  await drawer(page).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog', { name: 'Discard unsaved changes?' }).getByRole('button', { name: 'Discard', exact: true }).click();
  controls.value = { ...initial, desc: 'Changed on server' };
  await page.reload();
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await drawer(page).getByRole('button', { name: 'Drafts', exact: true }).click();
  await unlock(page);
  const review = page.getByRole('dialog', { name: 'Restore local draft', exact: true });
  await expect(review).toBeVisible();
  expect(controls.writes).toEqual([]);
  await review.getByRole('button', { name: 'Restore into editor' }).click();
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('Private draft');
  await drawer(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Resolve concurrent changes' })).toBeVisible();
  expect(controls.writes).toEqual([]);
});

test('wrong passwords and unavailable server reads preserve both stored and active drafts', async ({ page }) => {
  const controls = await setup(page);
  await store(page);
  const before = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  await unlock(page, 'wrong-password-value');
  await expect(vault(page).getByText(/Could not unlock this draft/)).toBeVisible();
  controls.failRead = true;
  await unlock(page);
  await expect(vault(page).getByRole('alert')).toContainText(/503/);
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)).toBe(before);
  await closeVault(page);
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('Private draft');
  expect(controls.writes).toEqual([]);
});

test('invalid JSON can be kept as an encrypted draft and cancelling recovery does not replace current edits', async ({ page }) => {
  await setup(page);
  await store(page, '{ unfinished draft');
  await closeVault(page);
  await uiFillMonacoEditor(page, drawer(page).locator('.monaco-editor'), JSON.stringify({ ...editable, desc: 'Current editing' }));
  await drawer(page).getByRole('button', { name: 'Drafts', exact: true }).click();
  await unlock(page);
  await page.getByRole('dialog', { name: 'Restore local draft' }).getByRole('button', { name: 'Keep editing' }).click();
  await closeVault(page);
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('Current editing');
});

test('storage failure never claims success and removing a stored draft preserves the editor', async ({ page }) => {
  await setup(page);
  await store(page);
  await closeVault(page);
  await drawer(page).getByRole('button', { name: 'Drafts', exact: true }).click();
  await vault(page).getByRole('button', { name: 'Remove stored draft', exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(vault(page).getByText(/No stored draft for this resource/)).toBeVisible();
  await page.evaluate(() => {
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (storageKey, value) {
      if (storageKey.startsWith('raw-draft:')) throw new Error('Storage quota exceeded');
      realSet.call(this, storageKey, value);
    };
  });
  await vault(page).getByRole('textbox', { name: 'Draft password', exact: true }).fill(password);
  await vault(page).getByRole('textbox', { name: 'Confirm draft password', exact: true }).fill(password);
  await vault(page).getByRole('button', { name: 'Save encrypted draft' }).click();
  await expect(vault(page).getByText('Storage quota exceeded', { exact: true })).toBeVisible();
  await expect(vault(page).getByText(/Encrypted draft saved on this browser/)).toBeHidden();
  await closeVault(page);
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('Private draft');
});

test('another tab changing the stored draft prevents accidental replacement', async ({ page }) => {
  await setup(page);
  await store(page);
  await page.evaluate((storageKey) => localStorage.setItem(storageKey, 'another-tab-draft'), key);
  await vault(page).getByRole('textbox', { name: 'Draft password', exact: true }).fill(password);
  await vault(page).getByRole('textbox', { name: 'Confirm draft password', exact: true }).fill(password);
  await vault(page).getByRole('button', { name: 'Replace stored draft' }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(vault(page).getByText(/stored draft changed in another tab/)).toBeVisible();
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)).toBe('another-tab-draft');
});

test('restoring a draft preserves unrelated server changes when it is applied', async ({ page }) => {
  const controls = await setup(page);
  await store(page);
  controls.value = { ...initial, uri: '/new-server-uri/*' };
  await unlock(page);
  const review = page.getByRole('dialog', { name: 'Restore local draft', exact: true });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Restore into editor' }).click();
  await drawer(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(drawer(page).getByText(/Saved at/)).toBeVisible();
  expect(controls.writes).toEqual([{ desc: 'Private draft token-123' }]);
  expect(controls.value.uri).toBe('/new-server-uri/*');
});

test('tampered ciphertext cannot replace the current editor', async ({ page }) => {
  await setup(page);
  await store(page);
  await closeVault(page);
  await page.evaluate((storageKey) => {
    const envelope = JSON.parse(localStorage.getItem(storageKey)!);
    envelope.ciphertext = (envelope.ciphertext.startsWith('A') ? 'B' : 'A') + envelope.ciphertext.slice(1);
    localStorage.setItem(storageKey, JSON.stringify(envelope));
  }, key);
  await drawer(page).getByRole('button', { name: 'Drafts', exact: true }).click();
  await unlock(page);
  await expect(vault(page).getByText(/Could not unlock this draft/)).toBeVisible();
  await closeVault(page);
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('Private draft');
});

test('draft storage remains usable at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await drawer(page).getByRole('button', { name: 'Drafts', exact: true }).click();
  for (const button of await vault(page).getByRole('button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
});
