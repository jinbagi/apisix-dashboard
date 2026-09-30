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

test('plugin close preserves invalid JSON until explicitly discarded', async ({ page }) => {
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
  await uiFillMonacoEditor(page, editor, 'invalid JSON draft');
  await expect(drawer.getByText('Fix Plugin JSON syntax before saving.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Cancel', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Discard plugin changes?' });
  await expect(confirmation).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('04-plugin-protected.png'), animations: 'disabled' });
  await confirmation.getByRole('button', { name: 'Keep editing' }).click();
  await expect(drawer.getByText('Fix Plugin JSON syntax before saving.')).toBeVisible();
  await expect(editor.getByText('invalid JSON draft')).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Discard changes' }).click();
  await expect(drawer).toBeHidden();
  expect(saved).toBeUndefined();
});
