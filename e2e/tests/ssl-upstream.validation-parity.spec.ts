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
import { expect, type Page,test } from '@playwright/test';

import { SSLPostSchema, SSLPutSchema } from '@/components/form-slice/FormPartSSL/schema';
import { FormPartUpstreamSchema, UpstreamPostSchema } from '@/components/form-slice/FormPartUpstream/schema';
import { getAdminResourceSchema } from '@/utils/resourceJsonSchema';
import { formatUpstreamNodeAddress, upstreamNodeMapToArray, upstreamNodeRowsToPayload } from '@/utils/upstreamNodes';

const ssl = { cert: 'test-certificate', key: 'test-key', sni: 'api.example.com' };
const identity = { id: 'parity', create_time: 1, update_time: 1 };
const sslCases = [
  { label: 'missing default certificate despite additional pair', payload: { key: 'key', certs: ['extra-cert'], keys: ['extra-key'], sni: 'api.example.com' }, valid: false },
  { label: 'missing default key despite additional pair', payload: { cert: 'cert', certs: ['extra-cert'], keys: ['extra-key'], sni: 'api.example.com' }, valid: false },
  { label: 'missing server name', payload: { cert: 'cert', key: 'key' }, valid: false },
  { label: 'conflicting server names', payload: { ...ssl, snis: ['other.example.com'] }, valid: false },
  { label: 'empty SNIs', payload: { cert: 'cert', key: 'key', snis: [] }, valid: false },
  { label: 'orphaned extra key', payload: { ...ssl, keys: ['extra-key'] }, valid: false },
  { label: 'orphaned extra certificate', payload: { ...ssl, certs: ['extra-cert'] }, valid: false },
  { label: 'blank extra certificate', payload: { ...ssl, certs: [''], keys: ['extra-key'] }, valid: false },
  { label: 'blank extra key', payload: { ...ssl, certs: ['extra-cert'], keys: [''] }, valid: false },
  { label: 'fractional client depth', payload: { ...ssl, client: { ca: 'client-ca', depth: 1.5 } }, valid: false },
  { label: 'paired server certificate', payload: { ...ssl, certs: ['extra-cert'], keys: ['extra-key'] }, valid: true },
  { label: 'client without server names', payload: { type: 'client', cert: 'cert', key: 'key' }, valid: true },
];
for (const { label, payload, valid } of sslCases) {
  test(`SSL shared validation: ${label}`, () => {
    const input = { ...identity, ...payload };
    const results = [SSLPostSchema, SSLPutSchema, getAdminResourceSchema('/ssls/parity')!].map((schema) => schema.safeParse(input));
    expect(results.map((result) => result.success)).toEqual([valid, valid, valid]);
    const errors = results.map((result) => result.success ? [] : result.error.issues.map(({ path, message }) => ({ path, message })));
    expect(errors[0]).toEqual(errors[2]);
    expect(errors[1]).toEqual(errors[2]);
  });
}

for (const [label, nodes, valid] of [
  ['optional port and metadata', [{ host: '2001:db8::1', weight: 0, metadata: { empty: '', nested: { __keep: null } } }], true],
  ['negative list weight', [{ host: 'localhost', weight: -1 }], false],
  ['negative map weight', { 'localhost:80': -1 }, false],
  ['fractional map weight', { 'localhost:80': 1.5 }, false],
  ['out of range port', [{ host: 'localhost', port: 65536, weight: 1 }], false],
] as const) {
  test(`Upstream shared validation: ${label}`, () => {
    const results = [UpstreamPostSchema, FormPartUpstreamSchema, getAdminResourceSchema('/upstreams/parity')!].map((schema) => schema.safeParse({ ...identity, nodes }));
    expect(results.map((result) => result.success)).toEqual([valid, valid, valid]);
  });
}

test('upstream conversion distinguishes bracketed IPv6 ports and retains node extensions', () => {
  expect(upstreamNodeMapToArray({ '[2001:db8::1]:8443': 2, '2001:db8::2': 3, 'example.com': 4, 'example.net:8080': 5 })).toEqual([
    { host: '2001:db8::1', port: 8443, weight: 2 }, { host: '2001:db8::2', weight: 3 }, { host: 'example.com', weight: 4 }, { host: 'example.net', port: 8080, weight: 5 },
  ]);
  const metadata = { empty: '', nullable: null, __keep: { values: [] } };
  const payload = upstreamNodeRowsToPayload([{ __rowKey: 'ui-only', id: 'future-node-id', host: '2001:db8::1', weight: 2, metadata, future_option: { text: '' } }]);
  expect(JSON.parse(JSON.stringify(payload))).toEqual([{ id: 'future-node-id', host: '2001:db8::1', weight: 2, metadata, future_option: { text: '' } }]);
  expect(formatUpstreamNodeAddress(payload[0])).toBe('2001:db8::1');
  expect(formatUpstreamNodeAddress({ host: '2001:db8::1', port: 8443 })).toBe('[2001:db8::1]:8443');
});

async function mockApi(page: Page, resource: string, initial: Record<string, unknown>) {
  let value = { ...identity, ...initial };
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path === `/${resource}/parity` || (path === `/${resource}` && request.method() === 'POST')) {
      if (['PUT', 'POST'].includes(request.method())) {
        const body = request.postDataJSON(); writes.push(body); value = { ...identity, ...body };
      }
      response = { value };
    } else if (path === `/${resource}`) response = { list: [{ value }], total: 1 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  return writes;
}

async function fillJson(page: Page, payload: unknown) {
  await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
  const editor = page.getByRole('tabpanel', { name: 'Payload JSON' }).locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text) => navigator.clipboard.writeText(text), JSON.stringify(payload, null, 2));
  await editor.click();
  await editor.getByRole('textbox').press('ControlOrMeta+A');
  await editor.getByRole('textbox').press('ControlOrMeta+V');
}

async function saveDetail(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
}

test('SSL JSON and visual save reject missing defaults, then accept corrected defaults', async ({ page }) => {
  const writes = await mockApi(page, 'ssls', {});
  await page.goto('ssls/add');
  await fillJson(page, { sni: 'api.example.com', certs: ['extra-cert'], keys: ['extra-key'] });
  await page.getByRole('tabpanel', { name: 'Payload JSON' }).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(/Validation failed:.*Default Certificate is required/s)).toBeVisible();
  await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Default Certificate is required').first()).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByLabel('Certificate 1', { exact: true }).fill('default-cert');
  await page.getByLabel('Private Key 1', { exact: true }).fill('default-key');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ cert: 'default-cert', key: 'default-key', certs: ['extra-cert'], keys: ['extra-key'] });
});

test('SSL conflicting names and an orphaned key can be repaired directly in the visual form', async ({ page }) => {
  const writes = await mockApi(page, 'ssls', { ...ssl, snis: ['other.example.com'], keys: ['extra-key'] });
  await page.goto('ssls/detail/parity');
  await expect(page.getByLabel('SNI', { exact: true })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'SNIs', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Certificate 2', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Private Key 2', { exact: true })).toHaveValue('extra-key');
  await page.getByLabel('SNI', { exact: true }).fill('changed.example.com');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Use either SNI or SNIs for a server certificate').first()).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByLabel('SNI', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('ssl-repairable-pairs.png'), animations: 'disabled' });
  await page.getByLabel('SNI', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review Changes Before Saving' })).toBeHidden();
  expect(writes).toHaveLength(0);
  await page.getByLabel('Certificate 2', { exact: true }).fill('extra-cert');
  await saveDetail(page);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ snis: ['other.example.com'], certs: ['extra-cert'], keys: ['extra-key'] });
  expect(writes[0]).not.toHaveProperty('sni');
});

test('IPv6 map addresses survive visual node editing without inventing ports', async ({ page }) => {
  const writes = await mockApi(page, 'upstreams', { nodes: { '[2001:db8::1]:8443': 2, '2001:db8::2': 3, 'example.com': 4 } });
  await page.goto('upstreams/detail/parity');
  const hosts = page.getByRole('textbox', { name: 'Host', exact: true });
  await expect(hosts.nth(0)).toHaveValue('2001:db8::1');
  await expect(hosts.nth(1)).toHaveValue('2001:db8::2');
  await expect(page.getByRole('spinbutton', { name: 'Port', exact: true }).nth(1)).toHaveValue('');
  await hosts.nth(2).fill('edited.example.com');
  await hosts.nth(2).blur();
  await saveDetail(page);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].nodes).toEqual([
    { host: '2001:db8::1', port: 8443, weight: 2 }, { host: '2001:db8::2', weight: 3 }, { host: 'edited.example.com', weight: 4 },
  ]);
});

test('editing a node retains metadata, future fields and an optional port', async ({ page }) => {
  const node = { id: 'future-node-id', host: '2001:db8::1', weight: 2, metadata: { empty: '', nullable: null, __keep: { values: [] } }, future_option: { text: '' } };
  const writes = await mockApi(page, 'upstreams', { nodes: [node] });
  await page.goto('upstreams/detail/parity');
  const host = page.getByRole('textbox', { name: 'Host', exact: true });
  await expect(host).toHaveValue('2001:db8::1');
  await host.fill('');
  await host.pressSequentially('2001:db8::2');
  await expect(host).toHaveValue('2001:db8::2');
  await host.blur();
  await saveDetail(page);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].nodes).toEqual([{ ...node, host: '2001:db8::2' }]);
});

for (const manager of ['__proto__', 'constructor']) {
  test(`invalid Secret manager ${manager} can be corrected without crashing the visual editor`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const writes = await mockApi(page, 'secrets/vault', {});
    await page.goto('secrets/add');
    await fillJson(page, { manager, id: 'parity', uri: 'http://vault.local:8200', prefix: 'kv', token: 'fake-token' });
    await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
    await page.getByRole('combobox', { name: 'Manager', exact: true }).click();
    await page.locator('.ant-select-dropdown').getByTitle('vault', { exact: true }).click();
    await page.getByLabel('URI', { exact: true }).fill('http://vault.local:8200');
    await page.getByLabel('Prefix', { exact: true }).fill('kv');
    await page.getByLabel('Token', { exact: true }).fill('fake-token');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ uri: 'http://vault.local:8200', prefix: 'kv', token: 'fake-token' });
    expect(errors).toEqual([]);
  });
}

test('empty SSL visual submission uses the shared error summary instead of native browser validation', async ({ page }) => {
  const writes = await mockApi(page, 'ssls', {});
  await page.goto('ssls/add');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Default Certificate is required').first()).toBeVisible();
  await expect(page.getByText('Default Private Key is required').first()).toBeVisible();
  await expect(page.getByText('A server certificate requires SNI or SNIs').first()).toBeVisible();
  expect(writes).toHaveLength(0);
});

test('Route expanded list formats portless and IPv6 inline nodes', async ({ page }) => {
  await mockApi(page, 'routes', { name: 'Portless route', uri: '/', upstream: { nodes: [
    { host: 'example.com', weight: 1 }, { host: '2001:db8::1', port: 443, weight: 2 },
  ] } });
  await page.goto('routes');
  await page.getByRole('button', { name: 'Expand row', exact: true }).first().click();
  const nodes = page.getByText('Inline nodes:', { exact: true }).locator('..');
  await expect(nodes).toBeVisible();
  await expect(nodes).toContainText('example.com, [2001:db8::1]:443');
  await expect(nodes).not.toContainText('undefined');
});

test('SSL description is editable and saved with its certificate binding', async ({ page }) => {
  const writes = await mockApi(page, 'ssls', { ...ssl, desc: 'Existing certificate note' });
  await page.goto('ssls/detail/parity');
  await page.getByLabel('Description', { exact: true }).fill('Certificate rotation note');
  await page.screenshot({ path: test.info().outputPath('ssl-description.png'), animations: 'disabled' });
  await saveDetail(page);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ ...ssl, desc: 'Certificate rotation note' });
});
