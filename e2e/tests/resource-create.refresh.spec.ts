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
import { expect, test } from '@playwright/test';

const cases = [
  { resource: 'upstreams', menu: 'Upstreams', add: 'Add Upstream', targetMenu: 'Services', targetAdd: 'Add Service', label: 'Upstream ID', payload: { name: 'created-resource', nodes: { 'localhost:80': 1 } } },
  { resource: 'services', menu: 'Services', add: 'Add Service', targetMenu: 'Routes', targetAdd: 'Add Route', label: 'Service ID', payload: { name: 'created-resource', plugins: {} } },
  { resource: 'consumer_groups', menu: 'Consumer Groups', add: 'Add Consumer Group', targetMenu: 'Consumers', targetAdd: 'Add Consumer', label: 'Consumer Group ID', payload: { id: 'fresh', name: 'created-resource', plugins: {} } },
  { resource: 'plugin_configs', menu: 'Plugin Configs', add: 'Add Plugin Config', targetMenu: 'Routes', targetAdd: 'Add Route', label: 'Plugin Config ID', payload: { id: 'fresh', name: 'created-resource', plugins: {} } },
];

// Prime the list and reference selector before creation to exercise staleTime.
for (const entry of cases) {
  test(`${entry.resource}: created and edited resources are immediately available in cached reference selectors and lists`, async ({ page }) => {
    let value: Record<string, unknown> | undefined;
    let reads = 0;
    await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
    await page.route('**/apisix/admin/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
      let response: unknown = { list: [], total: 0 };
      if ((path === `/${entry.resource}` || path === `/${entry.resource}/fresh`) && ['POST', 'PUT'].includes(request.method())) {
        value = { ...request.postDataJSON(), id: 'fresh', create_time: 1, update_time: 1 };
        response = { value };
      } else if (path === `/${entry.resource}/fresh`) response = { value };
      else if (path === `/${entry.resource}`) {
        reads += 1;
        response = { list: value ? [{ value }] : [], total: value ? 1 : 0 };
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
    });
    await page.goto(entry.resource);
    await expect(page.getByRole('heading', { name: entry.menu, exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: entry.targetMenu, exact: true }).click();
    await page.getByRole('link', { name: entry.targetAdd, exact: true }).click();
    await page.getByRole('combobox', { name: entry.label, exact: true }).click();
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Escape');
    await page.getByRole('menuitem', { name: entry.menu, exact: true }).click();
    await page.getByRole('link', { name: entry.add, exact: true }).click();
    await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
    const editor = page.getByRole('tabpanel', { name: 'Payload JSON' }).locator('.monaco-editor').first();
    await expect(editor).toBeVisible();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate((text) => navigator.clipboard.writeText(text), JSON.stringify(entry.payload));
    await editor.click();
    await editor.getByRole('textbox').press('ControlOrMeta+A');
    await editor.getByRole('textbox').press('ControlOrMeta+V');
    await page.getByRole('tabpanel', { name: 'Payload JSON' }).getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${entry.resource}/detail/fresh$`));
    await page.getByRole('menuitem', { name: entry.targetMenu, exact: true }).click();
    await page.getByRole('link', { name: entry.targetAdd, exact: true }).click();
    await page.getByRole('combobox', { name: entry.label, exact: true }).click();
    await page.getByRole('combobox', { name: entry.label, exact: true }).fill('fresh');
    const option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ has: page.getByText('fresh', { exact: true }) });
    await expect(option).toBeVisible();
    await expect(option).toContainText('created-resource');
    await page.screenshot({ path: test.info().outputPath(`${entry.resource}-fresh-options.png`), animations: 'disabled' });
    await option.click();
    await expect(page.getByRole('combobox', { name: entry.label, exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select")][1]')).toContainText('fresh');
    await page.getByRole('menuitem', { name: entry.menu, exact: true }).click();
    await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Discard and leave' }).click();
    await expect(page.getByRole('link', { name: 'created-resource', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`${entry.resource}-fresh-list.png`), animations: 'disabled' });
    // Renaming a verified resource must also update an already warmed selector.
    await page.getByRole('link', { name: 'created-resource', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('updated-resource');
    await page.getByLabel('Description', { exact: true }).fill('Updated description');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
    await expect(page.getByText('No pending changes', { exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: entry.targetMenu, exact: true }).click();
    await page.getByRole('link', { name: entry.targetAdd, exact: true }).click();
    await page.getByRole('combobox', { name: entry.label, exact: true }).click();
    await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'updated-resource' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('menuitem', { name: entry.menu, exact: true }).click();
    await expect(page.getByRole('link', { name: 'updated-resource', exact: true })).toBeVisible();
  });
}

for (const resource of ['protos', 'credentials']) {
  test(`${resource}: list exposes the supported resource name`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
    await page.route('**/apisix/admin/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/apisix/admin', '');
      let response: unknown = { list: [], total: 0 };
      if (path === '/consumers/parity') response = { value: { username: 'parity', plugins: {}, create_time: 1, update_time: 1 } };
      if (path === '/protos' || path === '/consumers/parity/credentials') response = { list: [{ value: { id: 'named', name: 'Readable resource name', content: 'syntax = "proto3";', plugins: {}, create_time: 1, update_time: 1 } }], total: 1 };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
    });
    await page.goto(resource === 'protos' ? 'protos' : 'consumers/detail/parity/credentials');
    await expect(page.getByRole('columnheader', { name: 'Name', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Readable resource name', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`${resource}-named-list.png`), animations: 'disabled' });
  });
}


test('a pre-creation selector response arriving after verification cannot hide the new resource', async ({ page }) => {
  let value: Record<string, unknown> | undefined;
  let initialReadPending = false;
  let releaseInitialRead: () => void = () => {};
  const initialRead = new Promise<void>((resolve) => { releaseInitialRead = resolve; });
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path === '/upstreams' && request.method() === 'POST') {
      value = { ...request.postDataJSON(), id: 'fresh', create_time: 1, update_time: 1 };
      response = { value };
    } else if (path === '/upstreams/fresh') response = { value };
    else if (path === '/upstreams') {
      response = { list: value ? [{ value }] : [], total: value ? 1 : 0 };
      if (url.searchParams.get('page_size') === '500' && !initialReadPending) {
        initialReadPending = true;
        await initialRead;
      }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('services/add');
  const oldResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/upstreams') && url.searchParams.get('page_size') === '500';
  });
  await page.getByRole('combobox', { name: 'Upstream ID', exact: true }).click();
  await expect.poll(() => initialReadPending).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('menuitem', { name: 'Upstreams', exact: true }).click();
  await page.getByRole('link', { name: 'Add Upstream', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Created during pending read');
  await page.getByRole('button', { name: 'Add a Node', exact: true }).click();
  await page.getByRole('textbox', { name: 'Host', exact: true }).fill('localhost');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(/upstreams\/detail\/fresh$/);
  releaseInitialRead();
  await oldResponse;
  await page.getByRole('menuitem', { name: 'Services', exact: true }).click();
  await page.getByRole('link', { name: 'Add Service', exact: true }).click();
  await page.getByRole('combobox', { name: 'Upstream ID', exact: true }).click();
  await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'Created during pending read' })).toBeVisible();
});
