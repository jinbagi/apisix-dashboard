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
import { expect, test } from '@playwright/test';
import axios from 'axios';

import { getImportRequest, IMPORT_ORDER } from '../../src/apis/export-import';
import { getGraphqlCostDecorations, saveGraphqlCostDecoration } from '../../src/apis/graphql_cost_decorations';
import { GraphqlCostDecoration } from '../../src/types/schema/apisix/graphql_cost_decorations';

for (const fieldPath of ['Query', 'Product', 'Query.products', 'Query.products.nodes.reviews']) {
  test(`accepts official GraphQL field path ${fieldPath}`, () => {
    expect(GraphqlCostDecoration.safeParse({ field_path: fieldPath, add_value: 0, mul_value: 0.5 }).success).toBe(true);
  });
}

test('rejects invalid GraphQL decorations', () => {
  for (const payload of [{ field_path: 'Query..products' }, { field_path: 'Query.products', mul_value: -1 }, { field_path: 'Query.products', add_arguments: [''] }]) {
    expect(GraphqlCostDecoration.safeParse(payload).success).toBe(false);
  }
});

test('uses the parent service in the URL and removes read-only ownership fields', async () => {
  const requests: unknown[] = [];
  const req = axios.create({ adapter: async (config) => {
    requests.push({ url: config.url, method: config.method, body: JSON.parse(config.data) });
    return { data: { value: { id: 'products' } }, status: 200, statusText: 'OK', headers: {}, config };
  } });
  await saveGraphqlCostDecoration(req, 'service-a', { id: 'products', service_id: 'wrong-parent', field_path: 'Query.products', create_time: 1, update_time: 2, mul_arguments: ['first'] });
  expect(requests).toEqual([{ url: '/services/service-a/graphql_cost_decorations/products', method: 'put', body: { field_path: 'Query.products', mul_arguments: ['first'] } }]);
  expect(getImportRequest('graphqlCostDecorations', { id: 'products', service_id: 'service-a', field_path: 'Query.products', create_time: 1 })).toEqual({ url: '/services/service-a/graphql_cost_decorations/products', body: { field_path: 'Query.products' } });
  expect(IMPORT_ORDER.indexOf('graphqlCostDecorations')).toBeGreaterThan(IMPORT_ORDER.indexOf('services'));
});

test('network errors are not converted into an empty decoration list', async () => {
  const req = axios.create({ adapter: async () => { throw new Error('network unavailable'); } });
  await expect(getGraphqlCostDecorations(req, 'service-a')).rejects.toThrow('network unavailable');
});

for (const inputId of ['products', '']) {
const savedId = inputId || 'generated';

test('creates, edits, reloads and deletes decoration with ' + (inputId || 'automatic ID'), async ({ page }) => {
  const values = new Map<string, Record<string, unknown>>();
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    let response: unknown = { list: [], total: 0 };
    if (path.startsWith('/services/service-a/graphql_cost_decorations')) {
      const id = path.split('/')[4];
      if (request.method() === 'DELETE') values.delete(id);
      else if (['POST', 'PUT'].includes(request.method())) {
        const body = request.postDataJSON();
        writes.push(body);
        values.set(id || 'generated', { ...body, id: id || 'generated', service_id: 'service-a', create_time: 1, update_time: 2 });
      }
      if (request.method() === 'GET' && id && !values.has(id)) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
      response = (id || ['POST', 'PUT'].includes(request.method())) ? { value: values.get(id || 'generated') } : { list: [...values.values()].map((value) => ({ value })), total: values.size };
    } else if (path === '/services/service-a') response = { value: { id: 'service-a', name: 'GraphQL backend' } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('services/detail/service-a/graphql_cost_decorations');
  await page.getByRole('button', { name: 'Add Decoration', exact: true }).click();
  await page.getByRole('textbox', { name: 'ID', exact: true }).fill(inputId);
  await page.getByRole('textbox', { name: 'Field Path', exact: true }).fill('Query.products');
  await page.getByRole('spinbutton', { name: 'Add Value', exact: true }).fill('0');
  await page.getByRole('combobox', { name: 'Multiply Arguments', exact: true }).fill('first');
  await page.getByRole('combobox', { name: 'Multiply Arguments', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('link', { name: savedId, exact: true })).toBeVisible();
  expect(writes[0]).toMatchObject({ field_path: 'Query.products', add_value: 0, mul_arguments: ['first'] });
  expect(writes[0]).not.toHaveProperty('service_id');
  expect(writes[0]).not.toHaveProperty('id');
  await page.getByRole('link', { name: savedId, exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Multiply Value', exact: true }).fill('2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review Changes Before Saving' }).getByRole('button', { name: 'Confirm & Save' }).click();
  await expect.poll(() => writes.length).toBe(2);
  await expect(page.getByText('GraphQL cost decoration saved and verified').last()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: 'Multiply Value', exact: true })).toHaveValue('2');
  await page.screenshot({ path: test.info().outputPath('graphql-cost-decoration.png'), fullPage: true });
  await page.getByRole('link', { name: 'All Cost Decorations', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('link', { name: savedId, exact: true })).toHaveCount(0);
});

}
