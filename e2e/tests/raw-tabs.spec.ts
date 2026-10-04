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

import { applyBulkPatch } from '@/apis/bulk-patch';

const routeResource = { create_time: 1, update_time: 1, id: 'tab-route', name: 'Catalog route', uri: '/catalog/*', desc: 'Route before', upstream: { nodes: { '127.0.0.1:1980': 1 } } };
const serviceResource = { create_time: 1, update_time: 1, id: 'tab-service', name: 'Catalog service', desc: 'Service before', upstream: { nodes: { '127.0.0.1:1980': 1 } } };
function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function mockApi(page: Page, controls: { initialRead?: ReturnType<typeof deferred>; patch?: ReturnType<typeof deferred>; preflight?: ReturnType<typeof deferred> } = {}) {
  const values: Record<string, Record<string, unknown>> = { '/routes/tab-route': { ...routeResource }, '/services/tab-service': { ...serviceResource } };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const reads: string[] = [];
  let firstRead = true;
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    if (request.method() === 'GET') reads.push(path);
    if (values[path]) {
      if (path === '/routes/tab-route' && request.method() === 'GET' && firstRead) {
        firstRead = false;
        if (controls.initialRead) {
          const initial = structuredClone(values[path]);
          await controls.initialRead.promise;
          return route.fulfill({ json: { value: initial } });
        }
      } else if (path === '/routes/tab-route' && request.method() === 'GET' && controls.preflight) {
        await controls.preflight.promise;
        values[path] = { ...values[path], desc: 'Server changed during save' };
      }
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON(); writes.push({ path, body });
        if (path === '/routes/tab-route' && controls.patch) await controls.patch.promise;
        values[path] = applyBulkPatch(values[path], body);
      }
      return route.fulfill({ json: { value: values[path] } });
    }
    if (path === '/routes' || path === '/services') return route.fulfill({ json: { list: [{ value: values[`${path}/${path === '/routes' ? 'tab-route' : 'tab-service'}`] }], total: 1 } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  return { writes, reads };
}
const drawer = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('tablist', { name: 'RAW resource tabs' }) });
const activePanel = (page: Page) => drawer(page).getByRole('tabpanel');
async function openRoute(page: Page) {
  await page.goto('routes');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(activePanel(page).getByRole('textbox', { name: 'Editor content' })).toBeVisible();
}
async function openService(page: Page) {
  await drawer(page).getByRole('button', { name: 'Minimize', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Services', exact: true }).click();
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(activePanel(page).getByRole('textbox', { name: 'Editor content' })).toBeVisible();
}
async function edit(page: Page, resource: typeof routeResource | typeof serviceResource, desc: string) {
  const editable = Object.fromEntries(Object.entries(resource).filter(([key]) => !['id', 'create_time', 'update_time'].includes(key)));
  await uiFillMonacoEditor(page, activePanel(page).locator('.monaco-editor'), JSON.stringify({ ...editable, desc }));
  await expect(activePanel(page).getByRole('button', { name: 'Save Changes', exact: true })).toBeEnabled();
  await expect.poll(() => editorValue(page)).toBe(JSON.stringify({ ...editable, desc }));
}
async function editorValue(page: Page) {
  return page.evaluate(() => window.__monacoEditor__?.getValue());
}

test('mixed-resource tabs keep independent drafts, reuse duplicate opens, and save only the active resource', async ({ page }, testInfo) => {
  const { writes, reads } = await mockApi(page);
  await openRoute(page);
  await edit(page, routeResource, 'Private route draft');
  await openService(page);
  await edit(page, serviceResource, 'Private service draft');
  await expect(drawer(page).getByRole('tab')).toHaveCount(2);
  await drawer(page).getByRole('tab', { name: /Route: Catalog route/ }).click();
  await expect.poll(() => editorValue(page)).toContain('Private route draft');
  await drawer(page).getByRole('button', { name: 'Minimize', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Routes', exact: true }).click();
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(drawer(page).getByRole('tab')).toHaveCount(2);
  await expect.poll(() => editorValue(page)).toContain('Private route draft');
  await drawer(page).getByRole('tab', { name: /Service: Catalog service/ }).click();
  await expect.poll(() => editorValue(page)).toContain('Private service draft');
  const previousReads = reads.length;
  await activePanel(page).getByRole('textbox', { name: 'Editor content' }).press('ControlOrMeta+s');
  await expect(activePanel(page).getByText(/Saved at/)).toBeVisible();
  expect(writes).toEqual([{ path: '/services/tab-service', body: { desc: 'Private service draft' } }]);
  expect(reads.length).toBeGreaterThan(previousReads);
  await drawer(page).getByRole('tab', { name: /Route: Catalog route/ }).click();
  await expect(activePanel(page).getByText(/Unsaved changes/)).toBeVisible();
  await activePanel(page).getByRole('button', { name: 'Format', exact: true }).click();
  await expect.poll(() => editorValue(page)).toContain('\n');
  await page.mouse.move(0, 0);
  await expect(page.locator('.ant-message-notice')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('raw-tabs-desktop.png') });
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('Private route draft'))).toBe(false);
});

test('late initial reads cannot replace another tab or overwrite its original dirty draft', async ({ page }) => {
  const initialRead = deferred();
  const { writes } = await mockApi(page, { initialRead });
  await openRoute(page);
  await edit(page, routeResource, 'Draft while loading');
  await openService(page);
  await edit(page, serviceResource, 'Independent service');
  initialRead.release();
  await expect.poll(() => editorValue(page)).toContain('Independent service');
  await drawer(page).getByRole('tab', { name: /Route: Catalog route/ }).click();
  await expect(activePanel(page).getByText(/Latest API data arrived after editing/)).toBeVisible();
  await expect.poll(() => editorValue(page)).toContain('Draft while loading');
  expect(writes).toEqual([]);
});

test('saving tabs cannot be closed and background save completion stays with its resource', async ({ page }) => {
  const patch = deferred();
  const { writes } = await mockApi(page, { patch });
  await openRoute(page);
  await edit(page, routeResource, 'Route in flight');
  await activePanel(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(drawer(page).getByRole('button', { name: 'Close RAW tab: Route: Catalog route', exact: true })).toBeDisabled();
  await openService(page);
  await edit(page, serviceResource, 'Service in flight');
  await expect(drawer(page).getByRole('button', { name: 'Close all', exact: true })).toBeDisabled();
  await activePanel(page).getByRole('textbox', { name: 'Editor content' }).press('ControlOrMeta+s');
  await expect(activePanel(page).getByText(/Saved at/)).toBeVisible();
  patch.release();
  await expect(drawer(page).getByRole('button', { name: 'Close RAW tab: Route: Catalog route', exact: true })).toBeEnabled();
  await expect.poll(() => editorValue(page)).toContain('Service in flight');
  await drawer(page).getByRole('tab', { name: /Route: Catalog route/ }).click();
  await expect(activePanel(page).getByText(/Saved at/)).toBeVisible();
  expect(writes.map((write) => write.path)).toEqual(['/routes/tab-route', '/services/tab-service']);
});

test('close tab and close all protect dirty drafts and support keyboard tab navigation', async ({ page }) => {
  await mockApi(page);
  await openRoute(page);
  await edit(page, routeResource, 'Keep route');
  await openService(page);
  await edit(page, serviceResource, 'Keep service');
  await drawer(page).getByRole('tab', { name: /Service: Catalog service/ }).press('ArrowLeft');
  await expect(drawer(page).getByRole('tab', { name: /Route: Catalog route/ })).toBeFocused();
  await drawer(page).getByRole('tab', { name: /Route: Catalog route/ }).press('Delete');
  const closeOne = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true });
  await closeOne.getByRole('button', { name: 'Keep editing' }).click();
  await drawer(page).getByRole('button', { name: 'Close all', exact: true }).click();
  const closeAll = page.getByRole('dialog', { name: 'Close all RAW tabs and discard unsaved changes?', exact: true });
  await expect(closeAll).toContainText('Route: Catalog route');
  await expect(closeAll).toContainText('Service: Catalog service');
  await closeAll.getByRole('button', { name: 'Keep editing' }).click();
  await expect(drawer(page).getByRole('tab')).toHaveCount(2);
  await drawer(page).getByRole('button', { name: 'Close all', exact: true }).click();
  await closeAll.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Open RAW workspace/ })).toHaveCount(0);
});

test('minimized dirty tabs protect browser unload and restore Monaco cursor and scroll', async ({ page }) => {
  await mockApi(page);
  await openRoute(page);
  await edit(page, routeResource, 'Unsaved in-memory marker');
  await page.evaluate((value) => window.__monacoEditor__!.setValue(value), JSON.stringify({ name: routeResource.name, uri: routeResource.uri, upstream: routeResource.upstream, desc: 'Unsaved in-memory marker', future_field: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, index])) }, null, 2));
  const location = await page.evaluate(() => {
    const editor = window.__monacoEditor__!;
    editor.setPosition({ lineNumber: 30, column: 3 });
    editor.setScrollTop(240);
    return { position: editor.getPosition(), scroll: editor.getScrollTop() };
  });
  await openService(page);
  await drawer(page).getByRole('tab', { name: /Route: Catalog route/ }).click();
  await expect.poll(() => page.evaluate(() => ({ position: window.__monacoEditor__!.getPosition(), scroll: window.__monacoEditor__!.getScrollTop() }))).toEqual(location);
  await drawer(page).getByRole('button', { name: 'Minimize', exact: true }).click();
  const canUnload = await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  expect(canUnload).toBe(false);
  await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: /^Open RAW workspace \(2 tabs, 1 unsaved\)/ }).click();
  await expect.poll(() => editorValue(page)).toContain('Unsaved in-memory marker');
  await drawer(page).getByRole('button', { name: 'Close all', exact: true }).click();
  await page.getByRole('dialog', { name: 'Close all RAW tabs and discard unsaved changes?' }).getByRole('button', { name: 'Discard', exact: true }).click();
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
});

test('narrow tab workspace keeps navigation, minimizing, and save actions reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await openRoute(page);
  await openService(page);
  await edit(page, serviceResource, 'Small screen draft');
  for (const name of ['Minimize', 'Close all', 'Save Changes']) await expect(drawer(page).getByRole('button', { name, exact: true })).toBeInViewport();
  expect(await drawer(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(drawer(page).getByRole('button', { name: 'Close RAW tab: Service: Catalog service', exact: true })).toBeInViewport({ ratio: 1 });
  await activePanel(page).getByRole('button', { name: 'Format', exact: true }).click();
  await expect.poll(() => editorValue(page)).toContain('\n');
  await page.mouse.move(0, 0);
  await expect(page.locator('.ant-message-notice')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('raw-tabs-narrow.png') });
  await drawer(page).getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Open RAW workspace/ })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test('a background conflict waits for its tab instead of opening over another editor', async ({ page }) => {
  const preflight = deferred();
  const { writes, reads } = await mockApi(page, { preflight });
  await openRoute(page);
  await edit(page, routeResource, 'Conflicting route draft');
  await activePanel(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect.poll(() => reads.filter((path) => path === '/routes/tab-route').length).toBe(2);
  await openService(page);
  await edit(page, serviceResource, 'Service still editable');
  preflight.release();
  await expect(drawer(page).getByRole('button', { name: 'Close RAW tab: Route: Catalog route', exact: true })).toBeEnabled();
  await expect(page.getByRole('dialog', { name: 'Resolve concurrent changes', exact: true })).toHaveCount(0);
  await expect.poll(() => editorValue(page)).toContain('Service still editable');
  await drawer(page).getByRole('tab', { name: /Route: Catalog route/ }).click();
  await expect(page.getByRole('dialog', { name: 'Resolve concurrent changes', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('closing and reopening a loading tab ignores its previous pending response', async ({ page }) => {
  const initialRead = deferred();
  await mockApi(page, { initialRead });
  await openRoute(page);
  await drawer(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(drawer(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(activePanel(page).getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await edit(page, routeResource, 'Reopened draft');
  initialRead.release();
  await expect.poll(() => editorValue(page)).toContain('Reopened draft');
  await expect(drawer(page).getByRole('tab')).toHaveCount(1);
});


test('an earlier read cannot replace a verified save after the tab becomes clean', async ({ page }) => {
  const initialRead = deferred();
  const { writes } = await mockApi(page, { initialRead });
  await openRoute(page);
  await edit(page, routeResource, 'Verified before old read');
  await activePanel(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(activePanel(page).getByText(/Saved at/)).toBeVisible();
  initialRead.release();
  await expect(activePanel(page).getByText(/Latest API data arrived after editing/)).toBeVisible();
  await expect.poll(() => editorValue(page)).toContain('Verified before old read');
  await expect(activePanel(page).getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
  expect(writes).toEqual([{ path: '/routes/tab-route', body: { desc: 'Verified before old read' } }]);
});

test('inactive RAW widgets suspend without losing model undo history and close disposes the model', async ({ page }) => {
  const { writes } = await mockApi(page);
  await openRoute(page);
  const original = await editorValue(page);
  const model = await page.evaluateHandle(() => window.__monacoEditor__!.getModel()!);
  await page.evaluate(() => {
    const editor = window.__monacoEditor__!;
    editor.pushUndoStop();
    editor.executeEdits('fixture', [{ range: editor.getModel()!.getFullModelRange(), text: editor.getValue().replace('Route before', 'Undo survives') }]);
    editor.pushUndoStop();
  });
  await expect.poll(() => editorValue(page)).toContain('Undo survives');
  await openService(page);
  await expect(page.locator('.monaco-editor')).toHaveCount(1);
  expect(await model.evaluate((value) => value.isDisposed())).toBe(false);
  await drawer(page).getByRole('tab', { name: /Route: Catalog route/ }).click();
  await expect(activePanel(page).getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  expect(await model.evaluate((value) => value === window.__monacoEditor__!.getModel())).toBe(true);
  await activePanel(page).getByRole('textbox', { name: 'Editor content' }).press('ControlOrMeta+z');
  await expect.poll(() => editorValue(page)).toBe(original);
  await drawer(page).getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect(page.locator('.monaco-editor')).toHaveCount(0);
  expect(await model.evaluate((value) => value.isDisposed())).toBe(false);
  await page.getByRole('button', { name: 'Open RAW workspace (2 tabs)', exact: true }).click();
  await expect(activePanel(page).getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await drawer(page).getByRole('button', { name: 'Close all', exact: true }).click();
  await expect(page.locator('.monaco-editor')).toHaveCount(0);
  expect(await model.evaluate((value) => value.isDisposed())).toBe(true);
  await model.dispose();
  expect(writes).toEqual([]);
});