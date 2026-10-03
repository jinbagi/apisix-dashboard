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

import { readFile } from 'node:fs/promises';

import { getAPISIXConf, randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { expect, test } from '@playwright/test';

import type { ExportData } from '@/apis/export-import';

test('dependency bundle reads Service GraphQL children and grpc-transcode Proto from APISIX', async ({ page }) => {
  const id = randomId('dependency_bundle');
  const destination = `${id}_copy`;
  const { adminKey } = await getAPISIXConf();
  await page.addInitScript((key) => localStorage.setItem('settings:adminKey', JSON.stringify(key)), adminKey);
  const proto = 'syntax = "proto3"; package demo; service Greeter { rpc Say (Hello) returns (Hello) {} } message Hello { string name = 1; }';
  try {
    await e2eReq.put(`/protos/${id}`, { content: proto });
    await e2eReq.put(`/services/${id}`, { name: id, plugins: { 'grpc-transcode': { proto_id: id, service: 'demo.Greeter', method: 'Say' } } });
    await e2eReq.put(`/services/${id}/graphql_cost_decorations/products`, { field_path: 'Query.products', add_value: 2, mul_value: 1 });
    await page.goto('services');
    await page.getByRole('row').filter({ hasText: id }).getByRole('checkbox', { name: 'Select row', exact: true }).check();
    await page.getByRole('button', { name: 'Export with dependencies', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Export with dependencies', exact: true });
    await expect(modal.getByRole('button', { name: 'Refresh export preview' })).toBeEnabled();
    await modal.getByLabel('Include Service GraphQL cost decorations', { exact: true }).check();
    await expect(modal.getByRole('button', { name: 'Refresh export preview' })).toBeEnabled();
    await modal.getByLabel('Include supported plugin references', { exact: false }).check();
    await expect(modal.getByRole('status')).toHaveText('3 included · 0 unresolved references');
    const event = page.waitForEvent('download');
    await modal.getByRole('button', { name: 'Download bundle' }).click();
    const exported = JSON.parse(await readFile((await (await event).path())!, 'utf8')) as ExportData;
    expect(exported.resources.services[0].id).toBe(id);
    expect(exported.resources.protos[0]).toMatchObject({ id, content: proto });
    expect(exported.resources.graphqlCostDecorations?.[0]).toMatchObject({ service_id: id, id: 'products', field_path: 'Query.products', add_value: 2 });
    exported.resources.services[0].id = destination;
    (exported.resources.services[0].plugins as Record<string, { proto_id: string }>)['grpc-transcode'].proto_id = destination;
    exported.resources.protos[0].id = destination;
    exported.resources.graphqlCostDecorations![0].service_id = destination;
    await modal.getByRole('button', { name: 'Close export' }).click();
    await page.goto('export_import');
    await page.locator('input[type="file"]').setInputFiles({ name: 'dependency-bundle.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await page.getByRole('button', { name: 'Import Selected Resources', exact: true }).click();
    await page.getByRole('dialog', { name: 'Confirm Import', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText('Import Complete: 3 succeeded, 0 failed')).toBeVisible();
    const saved = await e2eReq.get(`/services/${destination}/graphql_cost_decorations/products`);
    expect(saved.data.value).toMatchObject({ field_path: 'Query.products', add_value: 2 });
  } finally {
    await e2eReq.delete(`/services/${destination}/graphql_cost_decorations/products`).catch(() => {});
    await e2eReq.delete(`/services/${destination}`).catch(() => {});
    await e2eReq.delete(`/protos/${destination}`).catch(() => {});
    await e2eReq.delete(`/services/${id}/graphql_cost_decorations/products`).catch(() => {});
    await e2eReq.delete(`/services/${id}`).catch(() => {});
    await e2eReq.delete(`/protos/${id}`).catch(() => {});
  }
});
