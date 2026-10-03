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
const history = (page: Page) => page.getByRole('dialog', { name: 'Resource change history', exact: true });
async function saveChange(page: Page) {
  await uiFillMonacoEditor(page, drawer(page).locator('.monaco-editor'), JSON.stringify({ ...editable, desc: 'Recorded change' }));
  await drawer(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(drawer(page).getByText(/Saved at/)).toBeVisible();
  await drawer(page).getByRole('button', { name: 'Change history', exact: true }).click();
  await expect(history(page).getByRole('button', { name: 'Compare change' })).toHaveCount(1);
}

test('history reverses only recorded fields and rechecks concurrency when saving', async ({ page }) => {
  const controls = await setup(page);
  await saveChange(page);
  controls.value = { ...controls.value, uri: '/changed-on-server' };
  await history(page).getByRole('button', { name: 'Restore previous values' }).click();
  await page.getByRole('dialog', { name: 'Restore previous resource values' }).getByRole('button', { name: 'Restore into editor' }).click();
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('/changed-on-server');
  controls.value = { ...controls.value, desc: 'Concurrent edit' };
  await drawer(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Resolve concurrent changes' })).toBeVisible();
  expect(controls.writes).toEqual([{ desc: 'Recorded change' }]);
});

test('history restore preserves unrelated fields and persists the inverse patch', async ({ page }) => {
  const controls = await setup(page);
  await saveChange(page);
  controls.value = { ...controls.value, uri: '/keep-this' };
  await history(page).getByRole('button', { name: 'Restore previous values' }).click();
  await page.getByRole('dialog', { name: 'Restore previous resource values' }).getByRole('button', { name: 'Restore into editor' }).click();
  await drawer(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(drawer(page).getByText(/Saved at/)).toBeVisible();
  expect(controls.writes).toEqual([{ desc: 'Recorded change' }, { desc: 'Before' }]);
  expect(controls.value.uri).toBe('/keep-this');
});

test('changed fields and unreadable resources block history restore without writes', async ({ page }) => {
  const controls = await setup(page);
  await saveChange(page);
  controls.value = { ...controls.value, desc: 'External change' };
  await history(page).getByRole('button', { name: 'Restore previous values' }).click();
  await expect(history(page)).toContainText('Restore blocked: these fields changed again: desc');
  controls.failRead = true;
  await history(page).getByRole('button', { name: 'Restore previous values' }).click();
  await expect(history(page).getByRole('alert')).toContainText('503');
  expect(controls.writes).toHaveLength(1);
});

test('encrypted history survives reload and rejects a wrong password', async ({ page }) => {
  await setup(page);
  await saveChange(page);
  const secret = 'history-test-password';
  await history(page).getByRole('textbox', { name: 'History password', exact: true }).fill(secret);
  await history(page).getByRole('textbox', { name: 'Confirm history password', exact: true }).fill(secret);
  await history(page).getByRole('button', { name: 'Save encrypted history' }).click();
  await expect(history(page)).toContainText('Encrypted history saved');
  const stored = await page.evaluate(() => localStorage.getItem('resource-history:v1'));
  expect(stored).toBeTruthy(); expect(stored).not.toContain('Recorded change'); expect(stored).not.toContain(secret);
  await page.screenshot({ path: test.info().outputPath('history.png'), animations: 'disabled' });
  await page.reload();
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await drawer(page).getByRole('button', { name: 'Change history', exact: true }).click();
  await expect(history(page).getByRole('button', { name: 'Compare change' })).toHaveCount(0);
  await history(page).getByRole('textbox', { name: 'History password', exact: true }).fill('wrong-password');
  await history(page).getByRole('button', { name: 'Unlock saved history' }).click();
  await expect(history(page)).toContainText('Could not unlock');
  await history(page).getByRole('textbox', { name: 'History password', exact: true }).fill(secret);
  await history(page).getByRole('button', { name: 'Unlock saved history' }).click();
  await expect(history(page).getByRole('button', { name: 'Compare change' })).toHaveCount(1);
});

test('history archive detects another tab and supports narrow screens', async ({ page }) => {
  await setup(page); await saveChange(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('resource-history:v1', 'other-tab'));
  await history(page).getByRole('textbox', { name: 'History password', exact: true }).fill('history-test-password');
  await history(page).getByRole('textbox', { name: 'Confirm history password', exact: true }).fill('history-test-password');
  await history(page).getByRole('button', { name: 'Save encrypted history' }).click();
  await expect(history(page)).toContainText('History archive changed in another tab');
  const bounds = await history(page).boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
});
