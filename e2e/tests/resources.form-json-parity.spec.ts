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

const opaque = { empty: '', nullable: null, __plugin_key: 'keep', nested: { empty: '' } };
const cases = [
  { resource: 'services', payload: { hosts: ['api.example.com'], upstream: { nodes: { 'localhost:80': 1 }, discovery_args: opaque }, plugins: { 'response-rewrite': opaque } } },
  { resource: 'stream_routes', payload: { server_port: 9100, upstream: { nodes: { 'localhost:80': 1 } }, protocol: { name: 'custom', conf: opaque } } },
  { resource: 'upstreams', payload: { nodes: { 'localhost:80': 1 }, discovery_args: opaque, tls: { verify: false, future_tls_option: opaque } } },
  { resource: 'consumers', payload: { username: 'parity', plugins: { 'response-rewrite': opaque } } },
  { resource: 'ssls', payload: { cert: 'certificate', key: 'private-key', snis: ['api.example.com'], client: { ca: 'client-ca', future_client_option: opaque } } },
];

async function mockApi(page: Page, resource: string, initial: Record<string, unknown>) {
  let value = { id: 'parity', ...(resource === 'consumers' ? { username: 'parity' } : {}), create_time: 1, update_time: 1, ...initial };
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path === `/${resource}/parity` || (path === `/${resource}` && request.method() === 'POST')) {
      if (['PUT', 'POST', 'PATCH'].includes(request.method())) {
        const body = request.postDataJSON();
        writes.push(body);
        value = { id: 'parity', create_time: 1, update_time: 1, ...body };
      }
      response = { value };
    } else if (path === `/${resource}`) response = { list: [{ value }], total: 1 };
    else if (path.includes('/plugins/list')) response = ['response-rewrite'];
    else if (path.includes('/schema/plugins/')) response = { type: 'object', additionalProperties: true };
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

for (const { resource, payload } of cases) {
  for (const mode of ['create', 'edit'] as const) {
    test(`${resource} ${mode}: JSON-only and opaque values survive the visual editor and save`, async ({ page }) => {
      const input = { ...payload, future_field: opaque };
      const writes = await mockApi(page, resource, input);
      await page.goto(`${resource}/${mode === 'create' ? 'add' : 'detail/parity'}`);
      await fillJson(page, { ...input, desc: 'Edited through shared draft' });
      await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (resource === 'ssls') {
        // eslint-disable-next-line playwright/no-conditional-expect
        await expect(page.getByRole('switch', { name: 'Enable client certificate verification' })).toBeChecked();
        // eslint-disable-next-line playwright/no-conditional-expect
        await expect(page.getByLabel('Client CA Certificate', { exact: true })).toHaveValue('client-ca');
      }
      await page.getByRole('button', { name: mode === 'create' ? 'Add' : 'Save', exact: true }).click();
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (mode === 'edit') {
        await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
      }
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toMatchObject({ ...input, desc: 'Edited through shared draft' });
      expect(Object.keys(writes[0]).filter((key) => key.startsWith('__'))).toEqual([]);
      expect(writes[0]).not.toHaveProperty('create_time');
      expect(writes[0]).not.toHaveProperty('update_time');
      expect(writes[0]).not.toHaveProperty('id');
    });
  }
}

for (const { resource, payload } of cases) {
  test(`${resource}: direct Payload JSON save preserves opaque configuration`, async ({ page }) => {
    const writes = await mockApi(page, resource, {});
    await page.goto(`${resource}/add`);
    const input = { ...payload, future_field: opaque };
    await fillJson(page, input);
    await page.getByRole('tabpanel', { name: 'Payload JSON' }).getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject(input);
  });
}

test('JSON deletion removes an unmodeled field instead of restoring the saved value', async ({ page }) => {
  const writes = await mockApi(page, 'services', { ...cases[0].payload, future_field: opaque });
  await page.goto('services/detail/parity');
  await fillJson(page, cases[0].payload);
  await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toHaveProperty('future_field');
});

test('JSON health checks appear in the form and can be explicitly removed', async ({ page }) => {
  const writes = await mockApi(page, 'upstreams', {});
  await page.goto('upstreams/add');
  await fillJson(page, { nodes: { 'localhost:80': 1 }, checks: { active: { healthy: {}, unhealthy: {} }, passive: { healthy: { successes: 2 } } } });
  await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  const toggle = page.getByRole('switch', { name: 'Enable health checks', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toHaveProperty('checks');
});

for (const resource of ['services', 'stream_routes']) {
  test(`${resource}: inline upstream errors agree in form and Payload JSON`, async ({ page }) => {
    const writes = await mockApi(page, resource, {});
    await page.goto(`${resource}/add`);
    await fillJson(page, { upstream: { nodes: { 'localhost:80': 1 }, pass_host: 'rewrite' } });
    const panel = page.getByRole('tabpanel', { name: 'Payload JSON' });
    await panel.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(/Validation failed:.*upstream.upstream_host:/s)).toBeVisible();
    await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Upstream Host is required when Pass Host is rewrite').first()).toBeVisible();
    expect(writes).toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath(`${resource}-inline-validation.png`), animations: 'disabled' });
    await page.getByLabel('Upstream Host', { exact: true }).fill('backend.example.com');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ upstream: { upstream_host: 'backend.example.com' } });
  });
}

test('SSL disabling client verification explicitly removes the configuration', async ({ page }) => {
  const writes = await mockApi(page, 'ssls', cases[4].payload);
  await page.goto('ssls/detail/parity');
  const toggle = page.getByRole('switch', { name: 'Enable client certificate verification' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toHaveProperty('client');
});
