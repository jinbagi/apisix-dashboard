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

import { FormPartUpstreamSchema, UpstreamPostSchema } from '@/components/form-slice/FormPartUpstream/schema';
import { getAdminResourceSchema } from '@/utils/resourceJsonSchema';

// Synthetic PEM-shaped values exercise dashboard shape/length validation only.
// APISIX remains responsible for validating the certificate contents.
const caCertificate = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(128)}\n-----END CERTIFICATE-----`;
const secondCaCertificate = caCertificate.replace('A'.repeat(128), 'B'.repeat(128));
const identity = { id: 'apisix319', create_time: 1, update_time: 1 };
const nodes = [{ host: 'backend.example.com', port: 443, weight: 100 }];
const warmUp = {
  slow_start_time_seconds: 30,
  min_weight_percent: 10,
  interval: 2,
  aggression: 0.5,
  startup_grace_period_seconds: 0,
};
const schemas = [
  UpstreamPostSchema,
  FormPartUpstreamSchema,
  getAdminResourceSchema('/upstreams/apisix319')!,
];

for (const scheme of ['ws', 'wss']) {
  test(`APISIX 3.19 accepts the ${scheme} scheme in visual and JSON schemas`, () => {
    for (const schema of schemas) {
      expect(schema.safeParse({ ...identity, nodes, scheme }).success).toBe(true);
      expect(schema.safeParse({ ...identity, nodes, scheme, tls: { ca_certs: [caCertificate] } }).success).toBe(false);
    }
  });
}

const invalidSettings: { label: string; settings: Record<string, unknown> }[] = [
  { label: 'single CA string instead of an array', settings: { tls: { ca_certs: caCertificate } } },
  { label: 'empty CA array', settings: { tls: { ca_certs: [] } } },
  { label: 'short CA certificate', settings: { tls: { ca_certs: ['A'.repeat(127)] } } },
  { label: 'oversized CA certificate', settings: { tls: { ca_certs: ['A'.repeat(65537)] } } },
  { label: 'missing slow-start duration', settings: { warm_up_conf: { min_weight_percent: 10 } } },
  { label: 'missing minimum weight', settings: { warm_up_conf: { slow_start_time_seconds: 30 } } },
  { label: 'fractional slow-start duration', settings: { warm_up_conf: { ...warmUp, slow_start_time_seconds: 0.5 } } },
  { label: 'zero minimum weight', settings: { warm_up_conf: { ...warmUp, min_weight_percent: 0 } } },
  { label: 'minimum weight above 100 percent', settings: { warm_up_conf: { ...warmUp, min_weight_percent: 101 } } },
  { label: 'zero refresh interval', settings: { warm_up_conf: { ...warmUp, interval: 0 } } },
  { label: 'refresh interval exceeding slow-start duration', settings: { warm_up_conf: { ...warmUp, interval: 31 } } },
  { label: 'aggression below minimum', settings: { warm_up_conf: { ...warmUp, aggression: 0 } } },
  { label: 'negative startup grace', settings: { warm_up_conf: { ...warmUp, startup_grace_period_seconds: -1 } } },
  { label: 'fractional startup grace', settings: { warm_up_conf: { ...warmUp, startup_grace_period_seconds: 1.5 } } },
  { label: 'unsupported warm-up property', settings: { warm_up_conf: { ...warmUp, invented: true } } },
  { label: 'non-roundrobin slow start', settings: { type: 'least_conn', warm_up_conf: warmUp } },
  { label: 'multiple node priorities', settings: { nodes: [...nodes, { host: 'backup.example.com', weight: 100, priority: 1 }], warm_up_conf: warmUp } },
];

for (const { label, settings } of invalidSettings) {
  test(`APISIX 3.19 rejects ${label} consistently`, () => {
    for (const schema of schemas) {
      expect(schema.safeParse({ ...identity, nodes, scheme: 'https', ...settings }).success).toBe(false);
    }
    for (const resource of ['routes', 'services']) {
      expect(getAdminResourceSchema(`/${resource}/apisix319`)!.safeParse({
        ...identity, uri: '/apisix319', upstream: { nodes, scheme: 'https', ...settings },
      }).success).toBe(false);
    }
  });
}

test('APISIX 3.19 retains CA and slow-start fields without inventing defaults', () => {
  for (const schema of schemas) {
    const result = schema.parse({
      ...identity, nodes: [...nodes, { host: 'second.example.com', weight: 100, priority: 0 }],
      scheme: 'https', tls: { ca_certs: [caCertificate], verify: true },
      warm_up_conf: { slow_start_time_seconds: 1, min_weight_percent: 100 },
    });
    expect(result.tls).toEqual({ ca_certs: [caCertificate], verify: true });
    expect(result.warm_up_conf).toEqual({ slow_start_time_seconds: 1, min_weight_percent: 100 });
  }
});

test('APISIX 3.19 accepts exact CA and slow-start boundary values', () => {
  expect(UpstreamPostSchema.safeParse({
    nodes, scheme: 'https', tls: { ca_certs: ['A'.repeat(128), 'A'.repeat(65536)] },
    warm_up_conf: { slow_start_time_seconds: 1, min_weight_percent: 1, interval: 1, aggression: 0.01, startup_grace_period_seconds: 0 },
  }).success).toBe(true);
});

async function mockApi(page: Page, resource: string, initial: Record<string, unknown>) {
  let value = { ...identity, ...initial };
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path === `/${resource}/apisix319` || (path === `/${resource}` && request.method() === 'POST')) {
      if (['PUT', 'POST'].includes(request.method())) {
        const body = request.postDataJSON();
        writes.push(body);
        value = { ...identity, ...body };
      }
      response = { value };
    } else if (path === `/${resource}`) response = { list: [{ value }], total: 1 };
    else if (path.endsWith('/plugins/list')) response = [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  return writes;
}

async function saveDetail(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' })
    .getByRole('button', { name: 'Confirm & Save' }).click();
}

async function setPayloadJson(page: Page, value: unknown) {
  await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
  const editor = page.getByRole('tabpanel', { name: 'Payload JSON' }).locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getModel()?.getLanguageId())).toBe('json');
  await page.evaluate((text) => window.__monacoEditor__?.setValue(text), JSON.stringify(value, null, 2));
}

test('edits CA arrays and slow-start fields without losing the remaining upstream payload', async ({ page }) => {
  const writes = await mockApi(page, 'upstreams', {
    nodes, scheme: 'https', type: 'roundrobin',
    tls: { verify: true, ca_certs: [caCertificate, secondCaCertificate] },
    warm_up_conf: warmUp, future_setting: { preserved: true },
  });
  await page.goto('upstreams/detail/apisix319', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('CA Certificate 1', { exact: true })).toHaveValue(caCertificate);
  await expect(page.getByLabel('CA Certificate 2', { exact: true })).toHaveValue(secondCaCertificate);
  await page.getByRole('button', { name: 'Remove CA Certificate 1', exact: true }).click();
  await expect(page.getByLabel('CA Certificate 1', { exact: true })).toHaveValue(secondCaCertificate);
  await page.getByLabel('Slow Start Time', { exact: true }).fill('45');
  await page.getByLabel('Startup Grace Period', { exact: true }).fill('15');
  await page.locator('.form-section[data-label="Slow Start"]').screenshot({ path: test.info().outputPath('upstream-slow-start.png'), animations: 'disabled' });
  await saveDetail(page);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    tls: { verify: true, ca_certs: [secondCaCertificate] },
    warm_up_conf: { ...warmUp, slow_start_time_seconds: 45, startup_grace_period_seconds: 15 },
    future_setting: { preserved: true },
  });
  expect(writes[0]).not.toHaveProperty('id');
  expect(writes[0]).not.toHaveProperty('create_time');
});

for (const scheme of ['ws', 'wss']) {
  test(`selects native ${scheme} and saves after removing incompatible CA certificates`, async ({ page }) => {
    const writes = await mockApi(page, 'upstreams', { nodes, scheme: 'https', tls: { verify: true, ca_certs: [caCertificate] } });
    await page.goto('upstreams/detail/apisix319', { waitUntil: 'domcontentloaded' });
    await page.getByRole('combobox', { name: 'Scheme', exact: true }).click();
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle(scheme, { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add CA Certificate', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Review Changes Before Saving' })).toBeHidden();
    expect(writes).toHaveLength(0);
    await page.getByRole('button', { name: 'Remove CA Certificate 1', exact: true }).click();
    await saveDetail(page);
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ scheme, tls: { verify: true } });
    expect(writes[0].tls).not.toHaveProperty('ca_certs');
  });
}

test('JSON creation can round-trip new settings through the visual editor', async ({ page }) => {
  const writes = await mockApi(page, 'upstreams', {});
  const payload = { nodes, scheme: 'https', tls: { verify: true, ca_certs: [caCertificate] }, warm_up_conf: warmUp };
  await page.goto('upstreams/add', { waitUntil: 'domcontentloaded' });
  await setPayloadJson(page, payload);
  await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  await expect(page.getByLabel('CA Certificate 1', { exact: true })).toHaveValue(caCertificate);
  await expect(page.getByLabel('Aggression', { exact: true })).toHaveAttribute('aria-valuenow', '0.5');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject(payload);
});

test('inline Route upstream preserves the parent and edits prefixed 3.19 settings', async ({ page }) => {
  const writes = await mockApi(page, 'routes', {
    uri: '/inline319', desc: 'Parent route',
    upstream: { nodes, scheme: 'https', tls: { ca_certs: [caCertificate] }, warm_up_conf: warmUp },
  });
  await page.goto('routes/detail/apisix319', { waitUntil: 'domcontentloaded' });
  const inline = page.getByRole('group', { name: 'Inline Upstream target' });
  await expect(inline.getByLabel('CA Certificate 1', { exact: true })).toHaveValue(caCertificate);
  await inline.getByLabel('Minimum Weight', { exact: true }).fill('25');
  await inline.getByRole('button', { name: 'Add CA Certificate', exact: true }).click();
  await inline.getByLabel('CA Certificate 2', { exact: true }).fill(secondCaCertificate);
  await saveDetail(page);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    uri: '/inline319', desc: 'Parent route',
    upstream: { tls: { ca_certs: [caCertificate, secondCaCertificate] }, warm_up_conf: { ...warmUp, min_weight_percent: 25 } },
  });
  expect(writes[0]).not.toHaveProperty('warm_up_conf');
  expect(writes[0]).not.toHaveProperty('tls');
});

test('removes optional slow start without reintroducing it into the saved payload', async ({ page }) => {
  const writes = await mockApi(page, 'upstreams', { nodes, warm_up_conf: warmUp });
  await page.goto('upstreams/detail/apisix319', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Remove Slow Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Configure Slow Start', exact: true })).toBeVisible();
  await saveDetail(page);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toHaveProperty('warm_up_conf');
});


test('uploads CA certificates locally and retains edited certificates when adding another', async ({ page }) => {
  const writes = await mockApi(page, 'upstreams', { nodes, scheme: 'https', tls: { verify: true } });
  await page.goto('upstreams/detail/apisix319', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add CA Certificate', exact: true }).click();
  const fileInput = page.locator('[data-form-field="tls.ca_certs"] input[type="file"]').first();
  await fileInput.setInputFiles({ name: 'too-large.pem', mimeType: 'application/x-pem-file', buffer: Buffer.alloc(65537, 'A') });
  await expect(page.getByText('CA certificate files must be at most 64 KiB.')).toBeVisible();
  await fileInput.setInputFiles({ name: 'ca.pem', mimeType: 'application/x-pem-file', buffer: Buffer.from(caCertificate) });
  await expect(page.getByLabel('CA Certificate 1', { exact: true })).toHaveValue(caCertificate);
  await expect(page.getByText('CA certificate files must be at most 64 KiB.')).toBeHidden();
  await page.getByRole('button', { name: 'Add CA Certificate', exact: true }).click();
  await page.getByLabel('CA Certificate 2', { exact: true }).fill(secondCaCertificate);
  await expect(page.getByLabel('CA Certificate 1', { exact: true })).toHaveValue(caCertificate);
  await page.locator('[data-form-field="tls.ca_certs"]').screenshot({ path: test.info().outputPath('upstream-ca-certificates.png'), animations: 'disabled' });
  await saveDetail(page);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].tls).toEqual({ verify: true, ca_certs: [caCertificate, secondCaCertificate] });
});
