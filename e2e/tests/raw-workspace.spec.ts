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

import { getPatchConflictPaths } from '@/utils/apisixEditable';

const original = {
  id: 'workspace', name: 'Workspace route', uri: '/workspace/*', desc: 'Before',
  upstream: { nodes: { '127.0.0.1:1980': 1 } },
  future_field: { preserved: true }, create_time: 1, update_time: 1,
};
const editable = {
  name: original.name, uri: original.uri, desc: original.desc,
  upstream: original.upstream, future_field: original.future_field,
};

async function mockApi(page: Page, controls: { latest?: Record<string, unknown>; readStatus?: number } = {}) {
  let value: Record<string, unknown> = { ...original };
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    if (path === '/routes/workspace') {
      if (request.method() === 'GET') {
        if (controls.readStatus) return route.fulfill({ status: controls.readStatus, json: { error_msg: 'Unavailable' } });
        if (controls.latest) {
          value = controls.latest;
          controls.latest = undefined;
        }
      }
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        writes.push(body);
        value = { ...value, ...body };
      }
      return route.fulfill({ json: { value } });
    }
    if (path === '/routes') return route.fulfill({ json: { list: [{ value }], total: 1 } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  return writes;
}

async function openRaw(page: Page) {
  await page.goto('routes');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: /Route: Workspace route/ });
  await expect(drawer.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await expect(drawer).toBeInViewport({ ratio: 1 });
  return drawer;
}

test('RAW panel resizes with pointer and keyboard, remembers width, and restores from full screen', async ({ page }) => {
  await mockApi(page);
  const drawer = await openRaw(page);
  const handle = drawer.getByRole('separator', { name: 'Resize RAW panel' });
  await expect(handle).toHaveAttribute('aria-valuenow', '960');
  const bounds = await handle.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 80);
  await page.mouse.down();
  await page.mouse.move(800, bounds!.y + 80);
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '1120');
  await handle.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '1152');
  await expect(drawer).toHaveCSS('width', '1152px');
  await drawer.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect(drawer).toHaveCSS('width', '1920px');
  await expect(handle).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await expect(drawer).toHaveCSS('width', '1152px');
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(drawer).toHaveCSS('width', '1152px');
});

test('narrow RAW workspace keeps its actions inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  const drawer = await openRaw(page);
  await expect(drawer).toHaveCSS('width', '390px');
  await expect(drawer.getByRole('separator')).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Full screen', exact: true })).toHaveCount(0);
  for (const name of ['Review changes', 'Save Changes']) {
    const button = drawer.getByRole('button', { name, exact: true });
    await expect(button).toBeInViewport();
    const bounds = await button.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  expect(await drawer.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('RAW review is optional, cancellable, and saves only changed fields', async ({ page }) => {
  const writes = await mockApi(page);
  const drawer = await openRaw(page);
  const editor = drawer.locator('.monaco-editor');
  await uiFillMonacoEditor(page, editor, JSON.stringify({ ...editable, desc: 'After' }));
  await drawer.getByRole('button', { name: 'Review changes', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Changes Before Saving' });
  await expect(review).toBeVisible();
  expect(writes).toEqual([]);
  await review.getByRole('button', { name: 'Keep editing' }).click();
  await expect(drawer.getByText(/Unsaved changes/)).toBeVisible();
  await drawer.getByRole('button', { name: 'Review changes', exact: true }).click();
  await review.getByRole('button', { name: 'Confirm & Save' }).click();
  await expect(drawer.getByText(/Saved at/)).toBeVisible();
  expect(writes).toEqual([{ desc: 'After' }]);
  await uiFillMonacoEditor(page, editor, JSON.stringify({ ...editable, desc: 'Direct save' }));
  await drawer.getByRole('textbox', { name: 'Editor content' }).press('ControlOrMeta+s');
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual({ desc: 'Direct save' });
});

test('folded guidance reveals errors and resizing preserves the dirty draft', async ({ page }) => {
  const writes = await mockApi(page);
  const drawer = await openRaw(page);
  await expect(drawer.getByRole('button', { name: 'Show guidance' })).toHaveAttribute('aria-expanded', 'false');
  await drawer.getByRole('button', { name: 'Show guidance' }).click();
  await expect(drawer.getByText('Conditional requirements:', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Hide guidance' }).click();
  await uiFillMonacoEditor(page, drawer.locator('.monaco-editor'), '{invalid');
  await expect(drawer.getByText(/JSON syntax:/)).toBeVisible();
  await drawer.getByRole('button', { name: 'Review changes' }).click();
  await expect(drawer.getByText(/Cannot review invalid JSON/)).toBeVisible();
  await drawer.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect(drawer.getByText(/JSON syntax:/)).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await confirm.getByRole('button', { name: 'Keep editing' }).click();
  await expect(drawer.getByText(/Unsaved changes/)).toBeVisible();
  expect(writes).toEqual([]);
});

test('RAW preference survives reload and uses Payload JSON for creation without losing the preference', async ({ page }) => {
  await mockApi(page);
  await page.goto('routes/detail/workspace');
  await page.getByRole('tab', { name: 'Admin API JSON', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Admin API JSON', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goto('routes/add');
  await expect(page.getByRole('tab', { name: 'Payload JSON', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Payload JSON' }).getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await page.goto('routes/detail/workspace');
  await expect(page.getByRole('tab', { name: 'Admin API JSON', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('restored Payload JSON contains initialized resource values and preserves JSON-only fields', async ({ page }) => {
  await mockApi(page);
  await page.goto('routes/detail/workspace');
  await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
  await page.reload();
  const panel = page.getByRole('tabpanel', { name: 'Payload JSON' });
  await expect(panel.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__monacoEditor__?.getValue() || '{}'))).toMatchObject(editable);
  await uiFillMonacoEditor(page, panel.locator('.monaco-editor'), JSON.stringify({ ...editable, desc: 'Draft from JSON' }));
  await panel.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  await expect(page.getByLabel('Description').first()).toHaveValue('Draft from JSON');
  await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__monacoEditor__?.getValue() || '{}'))).toMatchObject({ ...editable, desc: 'Draft from JSON' });
});

test('RAW blocks a conflicting save and preserves the draft until latest is explicitly chosen', async ({ page }, testInfo) => {
  const controls: { latest?: Record<string, unknown> } = {};
  const writes = await mockApi(page, controls);
  const drawer = await openRaw(page);
  await uiFillMonacoEditor(page, drawer.locator('.monaco-editor'), JSON.stringify({ ...editable, desc: 'My draft' }));
  controls.latest = { ...original, desc: 'Changed by another operator' };
  await drawer.getByRole('button', { name: 'Save Changes', exact: true }).click();
  const conflict = page.getByRole('dialog', { name: 'Resolve concurrent changes' });
  await expect(conflict.getByText(/These fields changed in APISIX while you were editing: desc/)).toBeVisible();
  await expect(conflict.locator('.monaco-diff-editor')).toBeVisible();
  await expect(conflict).toHaveCSS('transform', 'none');
  await page.screenshot({ path: testInfo.outputPath('raw-conflict.png'), animations: 'disabled' });
  expect(writes).toEqual([]);
  await conflict.getByRole('button', { name: 'Keep editing' }).click();
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('My draft');
  await drawer.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await conflict.getByRole('button', { name: 'Use latest and discard draft' }).click();
  await expect(conflict).toBeHidden();
  await expect(drawer.getByText('No pending changes')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('Changed by another operator');
  expect(writes).toEqual([]);
});

test('RAW preserves independent concurrent changes and ignores server timestamps', async ({ page }) => {
  const controls: { latest?: Record<string, unknown> } = {};
  const writes = await mockApi(page, controls);
  const drawer = await openRaw(page);
  await uiFillMonacoEditor(page, drawer.locator('.monaco-editor'), JSON.stringify({ ...editable, desc: 'My draft' }));
  controls.latest = { ...original, name: 'New server name', update_time: 2 };
  await drawer.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(drawer.getByText(/Saved at/)).toBeVisible();
  expect(writes).toEqual([{ desc: 'My draft' }]);
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('New server name');
});

test('RAW sends no update when the latest state cannot be checked', async ({ page }) => {
  const controls: { readStatus?: number } = {};
  const writes = await mockApi(page, controls);
  const drawer = await openRaw(page);
  await uiFillMonacoEditor(page, drawer.locator('.monaco-editor'), JSON.stringify({ ...editable, desc: 'My draft' }));
  controls.readStatus = 503;
  await drawer.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(drawer.getByText(/Save failed:/).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toContain('My draft');
  expect(writes).toEqual([]);
});

test('conflict detection respects nested changes, field removal, arrays, and idempotent updates', () => {
  expect(getPatchConflictPaths({ plugins: { cors: { max_age: 10 } } },
    { plugins: { cors: { max_age: 5, allow_origins: '*' } } },
    { plugins: { cors: { max_age: 5, allow_origins: 'https://example.com' } } })).toEqual([]);
  expect(getPatchConflictPaths({ plugins: null },
    { plugins: { cors: { max_age: 5 } } },
    { plugins: { cors: { max_age: 10 } } })).toEqual(['plugins']);
  expect(getPatchConflictPaths({ methods: ['POST'] },
    { methods: ['GET'] }, { methods: ['PUT'] })).toEqual(['methods']);
  expect(getPatchConflictPaths({ desc: 'same', plugins: null },
    { desc: 'before', plugins: {} }, { desc: 'same' })).toEqual([]);
  expect(getPatchConflictPaths({ plugins: { cors: { max_age: 10 } } },
    { plugins: { cors: { max_age: 5 } } }, {})).toEqual(['plugins']);
});
