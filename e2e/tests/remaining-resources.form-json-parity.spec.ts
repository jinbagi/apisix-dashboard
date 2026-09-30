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

const opaque = { empty: '', nullable: null, __custom: 'keep', nested: { empty: '' } };
const cases = [
  { resource: 'consumer_groups', api: '/consumer_groups/parity', add: 'consumer_groups/add', detail: 'consumer_groups/detail/parity', payload: { id: 'parity', name: 'Group name', plugins: { 'key-auth': opaque } } },
  { resource: 'global_rules', api: '/global_rules/parity', add: 'global_rules/add', detail: 'global_rules/detail/parity', payload: { id: 'parity', plugins: { 'key-auth': opaque } } },
  { resource: 'plugin_configs', api: '/plugin_configs/parity', add: 'plugin_configs/add', detail: 'plugin_configs/detail/parity', payload: { id: 'parity', plugins: { 'key-auth': opaque } } },
  { resource: 'credentials', api: '/consumers/parity/credentials/parity', add: 'consumers/detail/parity/credentials/add', detail: 'consumers/detail/parity/credentials/detail/parity', payload: { id: 'parity', name: 'Credential name', plugins: { 'key-auth': opaque } } },
  { resource: 'protos', api: '/protos/parity', add: 'protos/add', detail: 'protos/detail/parity', payload: { content: 'syntax = "proto3";', name: 'Proto name', desc: 'Proto description', labels: { version: 'v1' } } },
  { resource: 'vault secret', api: '/secrets/vault/parity', add: 'secrets/add', detail: 'secrets/detail/vault/parity', payload: { manager: 'vault', id: 'parity', uri: 'http://vault.example.com', prefix: 'kv', token: 'fake-test-token' } },
  { resource: 'aws secret', api: '/secrets/aws/parity', add: 'secrets/add', detail: 'secrets/detail/aws/parity', payload: { manager: 'aws', id: 'parity', access_key_id: 'fake-access-key', secret_access_key: 'fake-secret-key' } },
  { resource: 'gcp secret', api: '/secrets/gcp/parity', add: 'secrets/add', detail: 'secrets/detail/gcp/parity', payload: { manager: 'gcp', id: 'parity', auth_config: { client_email: 'test@example.com', private_key: 'fake-test-key', project_id: 'test', future_option: opaque }, ssl_verify: false } },
];

async function mockApi(page: Page, api: string, initial: Record<string, unknown>) {
  let value = { id: api.startsWith('/secrets/') ? api.slice('/secrets/'.length) : 'parity', create_time: 1, update_time: 1, ...initial };
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path === api || (path === '/protos' && request.method() === 'POST')) {
      if (['PUT', 'POST', 'PATCH'].includes(request.method())) {
        const body = request.postDataJSON(); writes.push(body);
        value = { id: value.id, create_time: 1, update_time: 1, ...body };
      }
      response = { value };
    } else if (path === '/consumers/parity') response = { value: { username: 'parity', create_time: 1, update_time: 1 } };
    else if (path.includes('/plugins/list')) response = ['key-auth'];
    else if (path.includes('/schema/plugins/')) response = { schema: { type: 'object', additionalProperties: true }, consumer_schema: { type: 'object', additionalProperties: true } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  return writes;
}

async function fillJson(page: Page, value: unknown) {
  await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
  const editor = page.getByRole('tabpanel', { name: 'Payload JSON' }).locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text) => navigator.clipboard.writeText(text), JSON.stringify(value, null, 2));
  await editor.click();
  await editor.getByRole('textbox').press('ControlOrMeta+A');
  await editor.getByRole('textbox').press('ControlOrMeta+V');
}


for (const item of cases) {
  for (const mode of ['create', 'edit', 'json'] as const) {
    test(`${item.resource} ${mode}: preserves JSON-only and opaque configuration`, async ({ page }) => {
      const input = { ...item.payload, future_field: opaque };
      const writes = await mockApi(page, item.api, input);
      await page.goto(mode === 'edit' ? item.detail : item.add);
      await fillJson(page, { ...input, future_field: { ...opaque, changed: true } });
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (mode !== 'json') {
        await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
        // eslint-disable-next-line playwright/no-conditional-in-test
        if (['consumer_groups', 'credentials', 'protos'].includes(item.resource)) {
          // eslint-disable-next-line playwright/no-conditional-expect
          await expect(page.getByLabel('Name', { exact: true })).toHaveValue(item.payload.name!);
        }
      }
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (item.resource === 'protos' && mode === 'create') await page.screenshot({ path: test.info().outputPath('proto-basic-fields.png'), animations: 'disabled' });
      await page.getByRole('button', { name: mode === 'edit' ? 'Save' : 'Add', exact: true }).click();
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (mode === 'edit') await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
      await expect.poll(() => writes.length).toBe(1);
      const expected = { ...input } as Record<string, unknown>;
      delete expected.id; delete expected.manager;
      expect(writes[0]).toMatchObject({ ...expected, future_field: { ...opaque, changed: true } });
      expect(writes[0]).not.toHaveProperty('create_time');
      expect(writes[0]).not.toHaveProperty('update_time');
    });
  }
}

test('secret provider drafts survive switching and inactive fields never enter the request', async ({ page }) => {
  const writes = await mockApi(page, '/secrets/aws/parity', {});
  await page.goto('secrets/add');
  await fillJson(page, cases[5].payload);
  await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  const manager = page.getByRole('combobox', { name: 'Manager', exact: true });
  await manager.click(); await page.locator('.ant-select-dropdown').getByTitle('aws', { exact: true }).click();
  await page.getByLabel('Access Key ID', { exact: true }).fill('fake-access-key');
  await page.getByLabel('Secret Access Key', { exact: true }).fill('fake-secret-key');
  await manager.click(); await page.locator('.ant-select-dropdown').getByTitle('vault', { exact: true }).click();
  await expect(page.getByLabel('URI', { exact: true })).toHaveValue('http://vault.example.com');
  await manager.click(); await page.locator('.ant-select-dropdown').getByTitle('aws', { exact: true }).click();
  await expect(page.getByLabel('Access Key ID', { exact: true })).toHaveValue('fake-access-key');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toHaveProperty('uri'); expect(writes[0]).not.toHaveProperty('token');
  expect(writes[0]).toMatchObject({ access_key_id: 'fake-access-key', secret_access_key: 'fake-secret-key' });
});

test('plugin metadata Fields/JSON round trip preserves values outside visual controls', async ({ page }) => {
  let saved: Record<string, unknown> | undefined;
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path === '/plugins') response = { 'http-logger': { metadata_schema: { type: 'object', properties: { format: { type: 'string' } }, additionalProperties: true } } };
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
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text) => navigator.clipboard.writeText(text), JSON.stringify({ format: 'original', future_field: opaque }));
  await editor.click(); await editor.getByRole('textbox').press('ControlOrMeta+A'); await editor.getByRole('textbox').press('ControlOrMeta+V');
  await drawer.getByRole('tab', { name: 'Fields' }).click();
  await drawer.getByRole('textbox', { name: 'format', exact: true }).fill('edited');
  await drawer.getByRole('button', { name: 'Add Plugin', exact: true }).click();
  await expect.poll(() => saved).toEqual({ format: 'edited', future_field: opaque });
});
