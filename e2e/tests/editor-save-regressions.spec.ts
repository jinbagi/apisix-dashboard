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
import { expect, test } from '@playwright/test';

test('stream route can be edited and saved twice under a service', async ({ page }) => {
  let value = { id: 'stream', service_id: 'shared', create_time: 1, update_time: 1 } as Record<string, unknown>;
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path === '/stream_routes/stream') {
      if (request.method() === 'PUT') {
        writes.push(request.postDataJSON());
        value = { ...value, ...request.postDataJSON(), update_time: Number(value.update_time) + 1 };
      }
      response = { value };
    } else if (path === '/services/shared') response = { value: { id: 'shared', name: 'Shared service', create_time: 1, update_time: 1 } };
    else if (path === '/services') response = { list: [{ value: { id: 'shared', name: 'Shared service' } }], total: 1 };
    else if (path === '/plugins/list') response = [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('services/detail/shared/stream_routes/detail/stream');
  for (const port of [8080, 8081]) {
    await page.getByLabel('Server Address', { exact: true }).fill(`127.0.0.${port - 8079}`);
    const portInput = page.getByLabel('Server Port', { exact: true });
    await portInput.fill(String(port));
    await portInput.blur();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(page.getByText('No pending changes', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Server Port', { exact: true })).toHaveValue(String(port));
  }
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ server_addr: '127.0.0.2', server_port: 8081, service_id: 'shared' });
});

test('plugin JSON rejects syntax errors and saves a corrected draft in production', async ({ page }) => {
  let saved: Record<string, unknown> | undefined;
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path === '/plugins') response = { 'http-logger': { metadata_schema: { type: 'object', properties: { log_format: { type: 'object', additionalProperties: { type: 'string' } } } } } };
    if (path === '/plugin_metadata/http-logger') {
      if (request.method() === 'PUT') saved = request.postDataJSON();
      response = { value: saved };
    }
    if (path === '/plugin_metadata' && saved) response = { list: [{ key: '/plugin_metadata/http-logger', value: saved }], total: 1 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('plugin_metadata');
  await page.getByRole('button', { name: 'Add Plugin', exact: true }).click();
  await page.getByTestId('plugin-http-logger').getByRole('button', { name: 'Add', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Plugin: http-logger' });
  await drawer.getByRole('tab', { name: 'Plugin JSON' }).click();
  const editor = drawer.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  await uiFillMonacoEditor(page, editor, 'invalid JSON');
  await expect(drawer.getByText('Fix Plugin JSON syntax before saving.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Add Plugin', exact: true }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: /JSON format is not valid/ })).toBeVisible();
  expect(saved).toBeUndefined();
  await uiFillMonacoEditor(page, editor, JSON.stringify({ log_format: { host: '$host' } }));
  await expect(drawer.getByText('Fix Plugin JSON syntax before saving.')).toBeHidden();
  await drawer.getByRole('button', { name: 'Add Plugin', exact: true }).click();
  await expect(drawer).toBeHidden();
  expect(saved).toEqual({ log_format: { host: '$host' } });
});
