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

import { StreamRoutePostSchema, StreamRoutePutSchema } from '@/components/form-slice/FormPartStreamRoute/schema';
import { getAdminResourceSchema } from '@/utils/resourceJsonSchema';

const identity = { id: 'stream319', create_time: 1, update_time: 1 };
const upstream = { type: 'roundrobin', scheme: 'tcp', nodes: { '127.0.0.1:9443': 1 } };
const basePayload = { server_port: 9100, upstream };
const schemas = [StreamRoutePostSchema, StreamRoutePutSchema, getAdminResourceSchema('/stream_routes/stream319')!];

for (const tlsPassthrough of [true, false]) {
  test(`APISIX 3.19 Stream Route schemas retain TLS passthrough ${tlsPassthrough} and wildcard SNIs`, () => {
    const payload = { ...identity, ...basePayload, snis: ['api.example.com', '*.example.com', '*'], tls_passthrough: tlsPassthrough };
    for (const schema of schemas) {
      expect(schema.parse(payload)).toMatchObject({ snis: payload.snis, tls_passthrough: tlsPassthrough });
    }
  });
}

for (const item of [
  { label: 'conflicting SNI fields', extra: { sni: 'one.example.com', snis: ['two.example.com'] } },
  { label: 'empty SNIs', extra: { snis: [] } },
  { label: 'blank SNI entry', extra: { snis: [''] } },
  { label: 'invalid SNI pattern', extra: { snis: ['https://api.example.com'] } },
  { label: 'duplicate SNIs', extra: { snis: ['api.example.com', 'api.example.com'] } },
  { label: 'non-boolean TLS passthrough', extra: { tls_passthrough: 'false' } },
  { label: 'a second TLS handshake', extra: { tls_passthrough: true, upstream: { ...upstream, scheme: 'tls' } } },
]) {
  test(`APISIX 3.19 Stream Route schemas reject ${item.label}`, () => {
    for (const schema of schemas) {
      expect(schema.safeParse({ ...identity, ...basePayload, ...item.extra }).success).toBe(false);
    }
  });
}

async function mockStreamApi(page: Page, initial: Record<string, unknown> = basePayload) {
  let value = { ...identity, ...initial };
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path === '/stream_routes/stream319' || (path === '/stream_routes' && request.method() === 'POST')) {
      if (['PUT', 'POST'].includes(request.method())) {
        const body = request.postDataJSON();
        writes.push(body);
        value = { ...identity, ...body };
      }
      response = { value };
    } else if (path === '/stream_routes') {
      response = { list: [{ value }], total: 1 };
    } else if (path.includes('/plugins/list')) {
      response = [];
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  return writes;
}

async function fillPayloadJson(page: Page, value: unknown) {
  await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
  const editor = page.getByRole('tabpanel', { name: 'Payload JSON' }).locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text) => navigator.clipboard.writeText(text), JSON.stringify(value, null, 2));
  await editor.click();
  await editor.getByRole('textbox').press('ControlOrMeta+A');
  await editor.getByRole('textbox').press('ControlOrMeta+V');
}

async function saveDetail(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
}

test('Stream Route visual SNIs and TLS passthrough survive a Payload JSON round trip and create request', async ({ page }) => {
  const writes = await mockStreamApi(page);
  await page.goto('stream_routes/add');
  await fillPayloadJson(page, { id: identity.id, ...basePayload });
  await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  const snis = page.getByRole('combobox', { name: 'SNIs', exact: true });
  await snis.fill('api.example.com');
  await snis.press('Enter');
  await snis.fill('*.example.com');
  await snis.press('Enter');
  await snis.press('Escape');
  await page.getByRole('switch', { name: 'TLS Passthrough', exact: true }).click();
  await expect(page.getByLabel('SNI', { exact: true })).toBeDisabled();
  await expect(page.getByText(/both tls: true and tls_passthrough: true/)).toBeVisible();
  await expect(page.getByText('The upstream terminates the client TLS handshake.')).toBeVisible();
  await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
  await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  await expect(page.getByRole('switch', { name: 'TLS Passthrough', exact: true })).toBeChecked();
  await page.getByLabel('SNI', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('stream-route-apisix-319.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ snis: ['api.example.com', '*.example.com'], tls_passthrough: true, upstream });
  expect(writes[0]).not.toHaveProperty('sni');
  expect(writes[0]).not.toHaveProperty('id');
});

test('Stream Route PUT retains explicit false and removes cleared SNI and passthrough fields', async ({ page }) => {
  const writes = await mockStreamApi(page, { ...basePayload, snis: ['api.example.com'], tls_passthrough: true });
  await page.goto('stream_routes/detail/stream319');
  await expect(page.getByRole('switch', { name: 'TLS Passthrough', exact: true })).toBeChecked();
  await page.getByRole('switch', { name: 'TLS Passthrough', exact: true }).click();
  await saveDetail(page);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ tls_passthrough: false, snis: ['api.example.com'] });
  await expect(page.getByText('Stream Route saved and reloaded from APISIX', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'TLS Passthrough', exact: true })).not.toBeChecked();
  const snisField = page.locator('[data-form-field="snis"]');
  await snisField.locator('.ant-select-selection-item-remove').click();
  await page.getByRole('button', { name: 'Clear TLS passthrough setting', exact: true }).click();
  await expect(page.getByLabel('SNI', { exact: true })).toBeEnabled();
  await page.getByLabel('SNI', { exact: true }).fill('single.example.com');
  await saveDetail(page);
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({ sni: 'single.example.com' });
  expect(writes[1]).not.toHaveProperty('snis');
  expect(writes[1]).not.toHaveProperty('tls_passthrough');
  expect(writes[1]).not.toHaveProperty('id');
  expect(writes[1]).not.toHaveProperty('create_time');
  expect(writes[1]).not.toHaveProperty('update_time');
});

test('Stream Route conflicting SNI JSON is rejected and can be repaired in the visual form', async ({ page }) => {
  const writes = await mockStreamApi(page);
  await page.goto('stream_routes/add');
  await fillPayloadJson(page, { id: identity.id, ...basePayload, sni: 'one.example.com', snis: ['two.example.com'] });
  await page.getByRole('tabpanel', { name: 'Payload JSON' }).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(/Validation failed:.*Use either SNI or SNIs/s)).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  await expect(page.getByLabel('SNI', { exact: true })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'SNIs', exact: true })).toBeEnabled();
  await page.getByLabel('SNI', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ snis: ['two.example.com'] });
  expect(writes[0]).not.toHaveProperty('sni');
  expect(writes[0]).not.toHaveProperty('tls_passthrough');
});

test('Stream Route JSON submission preserves explicit false', async ({ page }) => {
  const writes = await mockStreamApi(page);
  await page.goto('stream_routes/add');
  await fillPayloadJson(page, { id: identity.id, ...basePayload, snis: ['api.example.com'], tls_passthrough: false });
  await page.getByRole('tabpanel', { name: 'Payload JSON' }).getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ snis: ['api.example.com'], tls_passthrough: false });
});
