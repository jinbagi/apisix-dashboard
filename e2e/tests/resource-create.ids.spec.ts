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
        const id = path.slice(resource.length + 1) || 'generated';
        value = { ...body, id: resource.startsWith('secrets/') ? `${resource.split('/')[1]}/${id}` : id, create_time: 1, update_time: 1 };
      }
      if (request.method() === 'GET' && path !== resource && !value) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
      response = path === resource && request.method() === 'GET'
        ? { list: value ? [{ value }] : [], total: value ? 1 : 0 }
        : { value };
    } else if (path === 'secrets' && resource.startsWith('secrets/')) response = { list: value ? [{ value }] : [], total: value ? 1 : 0 };
    else if (path === 'consumers/alice') response = { value: { username: 'alice', create_time: 1, update_time: 1 } };
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

async function openCreatedListDetail(page: Page, resource: string, id: string) {
  if (!['ssls', 'secrets'].includes(resource)) return;
  // These creation pages intentionally return to the list; inspect the persisted detail.
  await expect(page).toHaveURL((url) => url.pathname.endsWith(`/${resource}`));
  const label = resource === 'ssls' ? 'example.com' : id;
  // CopyableID can ellipsize DOM text after layout; its accessible cell name keeps the full ID.
  const identity = resource === 'ssls'
    ? page.getByRole('cell', { name: id, exact: true })
    : page.getByRole('link', { name: id, exact: true });
  const row = page.getByRole('row').filter({ has: identity });
  await row.getByRole('link', { name: label, exact: true }).click();
  const detail = resource === 'ssls' ? `/ssls/detail/${id}` : `/secrets/detail/vault/${id}`;
  await expect(page).toHaveURL((url) => url.pathname.endsWith(detail));
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
      await openCreatedListDetail(page, item.resource, `${customId}-${mode}`);
      await expect(page.getByLabel('ID', { exact: true })).toBeDisabled();
      await expect(page.getByLabel('ID', { exact: true })).toHaveValue(`${customId}-${mode}`);
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


test('SSL custom ID remains verifiable after the table visually ellipsizes it', async ({ page }) => {
  const id = `${customId}-form`;
  const writes = await mockApi(page, 'ssls');
  await page.goto('ssls/add');
  await fillJson(page, { id, cert: 'certificate', key: 'private-key', snis: ['example.com'], future_field: { keep: '' } });
  await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/ssls'));
  await page.evaluate(() => document.fonts.ready);
  // CI finished ellipsis measurement before the old full-text row selector ran.
  await page.addStyleTag({ content: '.ant-table-cell .ant-typography { display: inline-block; max-width: 64px !important; width: 64px !important; }' });
  const cell = page.getByRole('cell', { name: id, exact: true });
  await expect(cell).toContainText('...');
  await openCreatedListDetail(page, 'ssls', id);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ path: `ssls/${id}`, method: 'PUT', body: { snis: ['example.com'], future_field: { keep: '' } } });
  expect(writes[0].body).not.toHaveProperty('id');
  await expect(page.getByLabel('ID', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('ID', { exact: true })).toHaveValue(id);
});
