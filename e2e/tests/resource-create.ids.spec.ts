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

const customId = 'my-resource_1.v2';
const content = 'syntax = "proto3"; message Request { string name = 1; }';
const cases = [
  { resource: 'routes', payload: { uri: '/custom-id' } },
  { resource: 'stream_routes', payload: { server_port: 9100, upstream: { nodes: { 'localhost:80': 1 } } } },
  { resource: 'services', payload: { upstream: { nodes: { 'localhost:80': 1 } } } },
  { resource: 'upstreams', payload: { nodes: { 'localhost:80': 1 } } },
  { resource: 'ssls', payload: { cert: 'certificate', key: 'private-key', snis: ['example.com'] } },
  { resource: 'protos', payload: { content } },
  { resource: 'consumer_groups', payload: { plugins: {} } },
  { resource: 'plugin_configs', payload: { plugins: {} } },
  { resource: 'global_rules', payload: { plugins: {} } },
  { resource: 'secrets', api: 'secrets/vault', payload: { manager: 'vault', uri: 'http://vault.example.com', prefix: 'kv', token: 'test-token' } },
  { resource: 'consumers/alice/credentials', add: 'consumers/detail/alice/credentials/add', payload: { plugins: { 'key-auth': { key: 'test-key' } } } },
];

async function mockApi(page: Page, resource: string) {
  const writes: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  let value: Record<string, unknown> | undefined;
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin/', '');
    let response: unknown = { list: [], total: 0 };
    if (path === resource || path.startsWith(`${resource}/`)) {
      if (['POST', 'PUT'].includes(request.method())) {
        const body = request.postDataJSON();
        writes.push({ path, method: request.method(), body });
        value = { ...body, id: path.slice(resource.length + 1) || 'generated', create_time: 1, update_time: 1 };
      }
      response = path === resource && request.method() === 'GET'
        ? { list: value ? [{ value }] : [], total: value ? 1 : 0 }
        : { value };
    } else if (path === 'consumers/alice') response = { value: { username: 'alice', create_time: 1, update_time: 1 } };
    else if (path.includes('plugins/list')) response = ['key-auth'];
    else if (path.includes('schema/plugins/')) response = { schema: { type: 'object', additionalProperties: true }, consumer_schema: { type: 'object', additionalProperties: true } };
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
  for (const mode of ['form', 'json'] as const) {
    test(`${item.resource}: custom ID survives ${mode} creation`, async ({ page }) => {
      const api = item.api ?? item.resource;
      const writes = await mockApi(page, api);
      await page.goto(item.add ?? `${item.resource}/add`);
      await fillJson(page, { ...item.payload, id: customId, future_field: { keep: '' } });
      await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
      await expect(page.getByLabel('ID', { exact: true })).toBeEditable();
      await expect(page.getByLabel('ID', { exact: true })).toHaveValue(customId);
      // Verify that a subsequent visual ID edit is reflected by either submit path.
      await page.getByLabel('ID', { exact: true }).fill(`${customId}-${mode}`);
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (mode === 'json') await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toMatchObject({ path: `${api}/${customId}-${mode}`, method: 'PUT', body: { future_field: { keep: '' } } });
      expect(writes[0].body).not.toHaveProperty('id');
      expect(writes[0].body).not.toHaveProperty('create_time');
      expect(writes[0].body).not.toHaveProperty('update_time');
      await expect(page.getByLabel('ID', { exact: true })).toBeDisabled();
    });
  }
}

test('Proto Payload JSON creates an automatic ID when id is omitted', async ({ page }) => {
  const writes = await mockApi(page, 'protos');
  await page.goto('protos/add');
  await fillJson(page, { content, create_time: 1, update_time: 1 });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ path: 'protos', method: 'POST', body: { content } });
  await expect(page.getByLabel('ID', { exact: true })).toHaveValue('generated');
});
