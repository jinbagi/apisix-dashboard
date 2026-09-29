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

import { stripSystemReadonlyFields } from '@/utils/apisixEditable';

const expression = [['OR', ['arg_x', '==', ''], ['arg_y', '!', '==', null]], ['arg_n', 'in', [1, 2]]];
const original = {
  id: 'parity', create_time: 1, update_time: 1,
  uri: '/parity', host: 'api.example.com', desc: 'original',
  vars: expression, future_field: { enabled: true },
  service_id: 'shared', upstream_id: 'override',
  plugins: { 'response-rewrite': { body: '', headers: { 'X-Test': 'preserved' } } },
};

async function mockApi(page: Page, initial: Record<string, unknown> = original) {
  let value = { ...initial };
  const writes: { method: string; body: Record<string, unknown> }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key'));
  });
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path === '/routes/parity' || (path === '/routes' && request.method() === 'POST')) {
      if (request.method() === 'PUT' || request.method() === 'POST' || request.method() === 'PATCH') {
        const body = request.postDataJSON();
        writes.push({ method: request.method(), body });
        value = request.method() === 'PATCH' ? { ...value, ...body } : { id: 'parity', create_time: 1, update_time: 1, ...body };
      }
      response = { value };
    } else if (path.includes('/plugins/list')) response = ['response-rewrite'];
    else if (path.includes('/schema/plugins/')) response = { type: 'object', additionalProperties: true };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  return writes;
}

async function fillJson(page: Page, tab: string, value: unknown) {
  const panel = page.getByRole('tabpanel', { name: tab });
  const editor = panel.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getModel()?.getLanguageId())).toBe('json');
  await page.evaluate((text) => window.__monacoEditor__?.setValue(text), JSON.stringify(value, null, 2));

}

test('shows common matching fields without opening advanced matching', async ({ page }) => {
  await mockApi(page);
  await page.goto('routes/add');
  await expect(page.getByRole('textbox', { name: 'Host', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Hosts', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Remote Address', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Enable WebSocket' })).toBeVisible();
  await page.locator('.form-section').filter({ hasText: 'HTTP Methods' }).screenshot({ path: test.info().outputPath('route-match-fields.png') });
});

test('JSON create survives a form round trip with native vars and unmodeled fields', async ({ page }) => {
  const writes = await mockApi(page);
  await page.goto('routes/add');
  await page.getByRole('tab', { name: 'Payload JSON' }).click();
  const payload = stripSystemReadonlyFields(original);
  await fillJson(page, 'Payload JSON', payload);
  await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  await expect(page.getByRole('textbox', { name: 'Host', exact: true })).toHaveValue(payload.host);
  await expect(page.getByRole('textbox', { name: 'Vars JSON expression' })).toHaveValue(JSON.stringify(expression, null, 2));
  await page.getByRole('tab', { name: 'Payload JSON' }).click();
  await page.getByRole('tabpanel', { name: 'Payload JSON' }).getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject(payload);
  expect(writes[0].body.vars).toEqual(expression);
  expect(writes[0].body.__checksEnabled).toBeUndefined();
});

test('editing a description preserves JSON-only fields and routing overrides', async ({ page }) => {
  const writes = await mockApi(page);
  await page.goto('routes/detail/parity');
  await page.getByLabel('Description').first().fill('edited');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review Changes Before Saving' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm & Save' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({
    desc: 'edited', vars: expression, host: original.host,
    future_field: original.future_field, service_id: 'shared', upstream_id: 'override', plugins: original.plugins,
  });
  expect(writes[0].body.id).toBeUndefined();
  expect(writes[0].body.create_time).toBeUndefined();
});

test('both editors reject conflicting hosts and allow the user to correct them', async ({ page }) => {
  const writes = await mockApi(page, { ...original, hosts: ['other.example.com'] });
  await page.goto('routes/detail/parity');
  await page.getByLabel('Description').first().fill('edited');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Use either host or hosts, not both').first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Host', exact: true })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Hosts', exact: true })).toBeEnabled();
  expect(writes).toHaveLength(0);
  await page.getByRole('tab', { name: 'Admin API JSON' }).click();
  const payload = stripSystemReadonlyFields(original);
  await fillJson(page, 'Admin API JSON', { ...payload, desc: 'raw', hosts: ['other.example.com'] });
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText(/Schema validation failed:/)).toBeVisible();
  expect(writes).toHaveLength(0);
  await fillJson(page, 'Admin API JSON', { ...payload, desc: 'raw' });
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.hosts).toBeNull();
});

test('turning off inline health checks explicitly removes them', async ({ page }) => {
  const writes = await mockApi(page, {
    id: 'parity', create_time: 1, update_time: 1, uri: '/parity',
    upstream: { nodes: { 'localhost:80': 1 }, checks: { active: { type: 'http', healthy: { interval: 1 }, unhealthy: { interval: 1 } } } },
  });
  await page.goto('routes/detail/parity');
  const toggle = page.getByRole('switch', { name: 'Enable health checks', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.upstream).not.toHaveProperty('checks');
  expect(writes[0].body.upstream).not.toHaveProperty('name');
  expect(writes[0].body.upstream).not.toHaveProperty('service_name');
});

test('a form save reports an error if the API does not return the saved value', async ({ page }) => {
  await mockApi(page);
  await page.route('**/apisix/admin/routes/parity', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ value: original }) });
    } else await route.fallback();
  });
  await page.goto('routes/detail/parity');
  await page.getByLabel('Description').first().fill('not persisted');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
  await expect(page.getByText(/Save or verification failed: Admin API did not return the saved value for: desc/)).toBeVisible();
});
