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

const initial = { id: 'draft-route', name: 'Draft route', uri: '/draft/*', desc: 'Before', upstream: { nodes: { '127.0.0.1:1980': 1 } }, create_time: 1, update_time: 1 };
const editable = { name: initial.name, uri: initial.uri, desc: initial.desc, upstream: initial.upstream };
async function setup(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
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

async function fillRaw(page: Page, text: string) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  const content = drawer(page).getByRole('textbox', { name: 'Editor content' });
  await content.focus(); await content.press('Control+A'); await content.press('Control+V');
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue())).toBe(text);
}

test('RAW navigation moves between changed fields without saving', async ({ page }) => {
  const controls = await setup(page);
  await fillRaw(page, JSON.stringify({ ...editable, desc: 'Changed', uri: '/changed' }, null, 2));
  await drawer(page).getByRole('button', { name: 'Next field', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const ed = window.__monacoEditor__!; return ed.getModel()!.getLineContent(ed.getPosition()!.lineNumber);
  })).toContain('Changed');
  await page.keyboard.press('Alt+]');
  await expect.poll(() => page.evaluate(() => {
    const ed = window.__monacoEditor__!; return ed.getModel()!.getLineContent(ed.getPosition()!.lineNumber);
  })).toContain('/changed');
  expect(controls.writes).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('navigation.png'), animations: 'disabled' });
});

test('JSON path copying escapes property names and includes array indices', async ({ page }) => {
  await setup(page);
  await fillRaw(page, JSON.stringify({ ...editable, labels: { 'a/b~c': ['target'] } }, null, 2));
  await page.evaluate(() => {
    const ed = window.__monacoEditor__!; const model = ed.getModel()!;
    const offset = model.getValue().indexOf('target') + 1;
    ed.setPosition(model.getPositionAt(offset));
  });
  await drawer(page).getByRole('button', { name: 'Copy JSON path' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/labels/a~1b~0c/0');
});

test('syntax and schema problems move focus to the affected JSON', async ({ page }) => {
  await setup(page);
  await fillRaw(page, '{\n  "name": "test",\n  "uri": \n}');
  await drawer(page).getByRole('button', { name: /Next problem/ }).click();
  await expect(drawer(page).getByRole('status')).toContainText('ValueExpected');
  await fillRaw(page, JSON.stringify({ ...editable, priority: 'invalid' }, null, 2));
  await drawer(page).getByRole('button', { name: /Next problem/ }).click();
  await expect.poll(() => page.evaluate(() => {
    const ed = window.__monacoEditor__!; return ed.getModel()!.getLineContent(ed.getPosition()!.lineNumber);
  })).toContain('priority');
});

test('deleted fields jump to their parent and controls fit a narrow viewport', async ({ page }) => {
  await setup(page);
  await fillRaw(page, JSON.stringify({ name: editable.name, uri: editable.uri, upstream: editable.upstream }, null, 2));
  await drawer(page).getByRole('button', { name: 'Next field', exact: true }).click();
  expect(await page.evaluate(() => window.__monacoEditor__?.getPosition()?.lineNumber)).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await drawer(page).getByRole('button', { name: 'Show JSON tools', exact: true }).click();
  for (const label of ['Next field', 'Copy JSON path']) {
    const box = await drawer(page).getByRole('button', { name: label, exact: true }).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  }
});

test('narrow RAW gives editor space to the draft while keyboard tools remain available', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const controls = await setup(page);
  const draft = JSON.stringify({ ...editable, desc: 'Mobile draft' }, null, 2);
  await fillRaw(page, draft);
  const raw = drawer(page);
  const toggle = raw.getByRole('button', { name: 'Show JSON tools', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(raw.getByRole('button', { name: 'Next field', exact: true })).toHaveCount(0);
  await expect(raw.getByText('Minimize keeps tabs. Reload clears them.', { exact: true })).toBeVisible();
  const collapsed = (await raw.locator('.monaco-editor').boundingBox())!.height;
  expect(collapsed).toBeGreaterThan(300);
  await page.screenshot({ path: info.outputPath('raw-mobile-editor.png'), animations: 'disabled' });
  await toggle.focus(); await toggle.press('Enter');
  await expect(raw.getByRole('button', { name: 'Hide JSON tools', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const expanded = (await raw.locator('.monaco-editor').boundingBox())!.height;
  expect(collapsed - expanded).toBeGreaterThanOrEqual(75);
  await raw.getByRole('button', { name: 'Copy JSON path', exact: true }).focus();
  await raw.getByRole('button', { name: 'Copy JSON path', exact: true }).press('Escape');
  await expect(toggle).toBeFocused();
  await expect(raw.getByRole('button', { name: 'Next field', exact: true })).toHaveCount(0);
  const content = raw.getByRole('textbox', { name: 'Editor content' });
  await content.focus(); await content.press('Alt+]');
  await expect.poll(() => page.evaluate(() => {
    const editor = window.__monacoEditor__!; return editor.getModel()!.getLineContent(editor.getPosition()!.lineNumber);
  })).toContain('Mobile draft');
  expect(await page.evaluate(() => window.__monacoEditor__!.getValue())).toBe(draft);
  await expect(raw.getByRole('button', { name: 'Save Changes', exact: true })).toBeInViewport({ ratio: 1 });
  expect(controls.writes).toEqual([]);
});

test('narrow collapsed tools keep errors visible and F8 navigates to the invalid field', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const controls = await setup(page);
  await fillRaw(page, JSON.stringify({ ...editable, priority: 'invalid' }, null, 2));
  const raw = drawer(page);
  await expect(raw.getByText('Current payload needs attention:', { exact: true })).toBeVisible();
  await expect(raw.getByRole('button', { name: 'Show JSON tools', exact: true })).toHaveAttribute('aria-expanded', 'false');
  const problem = raw.getByRole('button', { name: /Next problem/ });
  await expect(problem).toBeVisible();
  await expect(problem).toBeEnabled();
  await raw.getByRole('textbox', { name: 'Editor content' }).press('F8');
  await expect.poll(() => page.evaluate(() => {
    const editor = window.__monacoEditor__!; return editor.getModel()!.getLineContent(editor.getPosition()!.lineNumber);
  })).toContain('priority');
  await expect(raw.getByRole('status')).toContainText('/priority');
  await fillRaw(page, JSON.stringify(editable, null, 2));
  await expect(problem).toHaveCount(0);
  await expect(raw.getByRole('button', { name: 'Show guidance', exact: true })).toBeVisible();
  expect(controls.writes).toEqual([]);
});

test('resizing a RAW panel folds navigation and closes its selector without changing the draft', async ({ page }) => {
  await setup(page);
  await fillRaw(page, JSON.stringify({ ...editable, desc: 'Keep selection' }, null, 2));
  const raw = drawer(page);
  await raw.getByRole('combobox', { name: 'Changed JSON field', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await raw.getByRole('separator', { name: 'Resize RAW panel', exact: true }).press('Home');
  await expect(raw.getByRole('button', { name: 'Show JSON tools', exact: true })).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(0);
  await raw.getByRole('button', { name: 'Show JSON tools', exact: true }).click();
  await expect(raw.getByRole('combobox', { name: 'Changed JSON field', exact: true })).toBeVisible();
  await raw.getByRole('separator', { name: 'Resize RAW panel', exact: true }).press('End');
  await expect(raw.getByRole('button', { name: 'Hide JSON tools', exact: true })).toHaveCount(0);
  await expect(raw.getByRole('button', { name: 'Next field', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(window.__monacoEditor__!.getValue()).desc)).toBe('Keep selection');
});