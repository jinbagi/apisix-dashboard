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
import { expect, type Page, type Request, test } from '@playwright/test';

import type { ExportData } from '@/apis/export-import';

const decoration = {
  id: 'products', service_id: 'service-a', field_path: 'Query.products',
  add_value: 0, mul_value: 2, mul_arguments: ['first'], create_time: 1, update_time: 2,
};

function exportData(decorations: Record<string, unknown>[], services: Record<string, unknown>[] = []): ExportData {
  return {
    version: 3, exportedAt: '2026-10-02T00:00:00.000Z',
    resources: {
      upstreams: [], services, graphqlCostDecorations: decorations,
      routes: [], streamRoutes: [], consumers: [], credentials: [], consumerGroups: [],
      ssls: [], globalRules: [], pluginConfigs: [], pluginMetadata: [], protos: [], secrets: [],
    },
  };
}

type MockResponse = { status?: number; body: unknown };
async function mockAdmin(page: Page, respond: (path: string, request: Request) => MockResponse | undefined | Promise<MockResponse | undefined>) {
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    const response = await respond(path, request);
    if (!response && request.method() === 'GET' && /^\/services\/[^/]+(?:\/graphql_cost_decorations\/[^/]+)?$/.test(path)) {
      await route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
      return;
    }
    await route.fulfill({
      status: response?.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response?.body ?? (path === '/plugins' ? {} : { list: [], total: 0 })),
    });
  });
}

async function uploadExport(page: Page, data: ExportData) {
  await page.goto('export_import', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'graphql-cost-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByText('graphql-cost-export.json')).toBeVisible();
}

async function confirmImport(page: Page) {
  await page.getByRole('button', { name: 'Import Selected Resources', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm Import' }).getByRole('button', { name: 'Import', exact: true }).click();
}

async function downloadExport(page: Page) {
  await page.goto('export_import', { waitUntil: 'domcontentloaded' });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export All Resources', exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ExportData;
}

test('exports same-named decorations from every service and handles empty service collections', async ({ page }) => {
  const services = ['service-a', 'service-b', 'service-empty'].map((id) => ({ id, name: id }));
  const decorationReads: string[] = [];
  await mockAdmin(page, (path) => {
    if (path === '/services') return { body: { list: services.map((value) => ({ value })), total: services.length } };
    if (path.endsWith('/graphql_cost_decorations')) {
      const serviceId = path.split('/')[2];
      decorationReads.push(serviceId);
      if (serviceId === 'service-empty') return { status: 404, body: { error_msg: 'Key not found' } };
      return { body: { list: [{ value: { ...decoration, service_id: serviceId } }], total: 1 } };
    }
  });
  const result = await downloadExport(page);
  expect(result.version).toBe(3);
  expect(result.resources.services).toEqual(services);
  expect(decorationReads.sort()).toEqual(['service-a', 'service-b', 'service-empty']);
  expect(result.resources.graphqlCostDecorations).toEqual([
    decoration, { ...decoration, service_id: 'service-b' },
  ]);
  expect(result.skippedResources).not.toContain('graphqlCostDecorations');
});

test('exports successful decoration reads but explicitly marks a failed service collection', async ({ page }) => {
  await mockAdmin(page, (path) => {
    if (path === '/services') return { body: { list: [{ value: { id: 'service-a' } }, { value: { id: 'service-failed' } }], total: 2 } };
    if (path === '/services/service-a/graphql_cost_decorations') return { body: { list: [{ value: decoration }], total: 1 } };
    if (path === '/services/service-failed/graphql_cost_decorations') return { status: 503, body: { error_msg: 'configuration store unavailable' } };
  });
  const result = await downloadExport(page);
  expect(result.resources.graphqlCostDecorations).toEqual([decoration]);
  expect(result.skippedResources).toContain('graphqlCostDecorations');
  await expect(page.getByText('Exported with 1 skipped: graphqlCostDecorations')).toBeVisible();
});

test('validates selected decorations locally and imports sanitized records after their parent services', async ({ page }) => {
  const writes: { path: string; body: unknown }[] = [];
  const validations: unknown[] = [];
  const services = [
    { id: 'service-a', name: 'First GraphQL service', create_time: 1, update_time: 2 },
    { id: 'service-b', name: 'Second GraphQL service', create_time: 3, update_time: 4 },
  ];
  const data = exportData([decoration, { ...decoration, service_id: 'service-b' }], services);
  await mockAdmin(page, (path, request) => {
    if (path === '/configs/validate') {
      validations.push(request.postDataJSON());
      return { body: {} };
    }
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return { body: { value: body } };
    }
  });
  await uploadExport(page, data);
  await expect(page.getByLabel('GraphQL Cost Decorations (2)')).toBeChecked();
  await page.getByLabel('Services (2)', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Validate Selected Resources', exact: true }).click();
  await expect(page.getByText('Configuration checks passed', { exact: true })).toBeVisible();
  await expect(page.getByText('GraphQL cost decorations are checked against the 3.19 schema locally.', { exact: false })).toBeVisible();
  expect(validations).toEqual([{}]);
  await page.getByLabel('Services (2)', { exact: true }).check();
  await confirmImport(page);
  await expect(page.getByText('Import Complete: 4 succeeded, 0 failed')).toBeVisible();
  expect(writes).toEqual([
    { path: '/services/service-a', body: { name: 'First GraphQL service' } },
    { path: '/services/service-b', body: { name: 'Second GraphQL service' } },
    { path: '/services/service-a/graphql_cost_decorations/products', body: { field_path: 'Query.products', add_value: 0, mul_value: 2, mul_arguments: ['first'] } },
    { path: '/services/service-b/graphql_cost_decorations/products', body: { field_path: 'Query.products', add_value: 0, mul_value: 2, mul_arguments: ['first'] } },
  ]);
});

test('does not claim validation success when an imported decoration has an empty service owner', async ({ page }) => {
  let validationRequests = 0;
  await mockAdmin(page, (path) => {
    if (path === '/configs/validate') validationRequests++;
  });
  await uploadExport(page, exportData([{ ...decoration, service_id: '' }]));
  await page.getByRole('button', { name: 'Validate Selected Resources', exact: true }).click();
  await expect(page.getByText(/configuration validation failed \(1\)/)).toBeVisible();
  await expect(page.getByText(/graphqlCostDecorations.*service_id:/)).toBeVisible();
  expect(validationRequests).toBe(0);
});

test('reports a missing owner per item and continues importing a later valid decoration', async ({ page }) => {
  const writes: { path: string; body: unknown }[] = [];
  await mockAdmin(page, (path, request) => {
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return { body: { value: body } };
    }
  });
  const unowned: Record<string, unknown> = { ...decoration };
  delete unowned.service_id;
  await uploadExport(page, exportData([{ ...unowned, id: 'missing-owner' }, decoration]));
  await confirmImport(page);
  await expect(page.getByText('Import Complete: 1 succeeded, 1 failed')).toBeVisible();
  await page.getByRole('button', { name: 'Expand row', exact: true }).click();
  await expect(page.getByText('missing-owner: GraphQL cost decorations require service_id and id')).toBeVisible();
  expect(writes).toEqual([{ path: '/services/service-a/graphql_cost_decorations/products', body: {
    field_path: 'Query.products', add_value: 0, mul_value: 2, mul_arguments: ['first'],
  } }]);
});

test('refreshes a clean cached decoration before another edit can overwrite newer values', async ({ page }) => {
  let current = { ...decoration, add_value: 1 };
  let delayDetail = false;
  let refreshStarted = false;
  let releaseRefresh: () => void = () => {};
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const writes: Record<string, unknown>[] = [];
  await mockAdmin(page, async (path, request) => {
    if (path === '/services/service-a/graphql_cost_decorations/products') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        writes.push(body);
        current = { ...current, ...body };
      } else if (delayDetail) {
        refreshStarted = true;
        await refreshGate;
      }
      return { body: { value: current } };
    }
    if (path === '/services/service-a/graphql_cost_decorations') return { body: { list: [{ value: current }], total: 1 } };
    if (path === '/services/service-a') return { body: { value: { id: 'service-a' } } };
  });
  await page.goto('services/detail/service-a/graphql_cost_decorations/detail/products', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('spinbutton', { name: 'Add Value', exact: true })).toHaveValue('1');
  await page.getByRole('link', { name: 'All Cost Decorations', exact: true }).click();
  await expect(page.getByRole('link', { name: 'products', exact: true })).toBeVisible();
  current = { ...current, add_value: 7, update_time: 3 };
  delayDetail = true;
  await page.getByRole('link', { name: 'products', exact: true }).click();
  await expect.poll(() => refreshStarted).toBe(true);
  await expect(page.getByRole('spinbutton', { name: 'Add Value', exact: true })).toHaveValue('1');
  releaseRefresh();
  await expect(page.getByRole('spinbutton', { name: 'Add Value', exact: true })).toHaveValue('7');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Multiply Value', exact: true }).fill('4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ field_path: 'Query.products', add_value: 7, mul_value: 4 });
  expect(writes[0]).not.toHaveProperty('id');
  expect(writes[0]).not.toHaveProperty('service_id');
});
