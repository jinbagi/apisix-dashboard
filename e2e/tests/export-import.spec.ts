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

import type { ExportData } from '@/apis/export-import';

test('imports uploaded resources with sanitized PUT payloads', async ({
  page,
}) => {
  const exportData: ExportData = {
    version: 2,
    exportedAt: '2026-07-03T00:00:00.000Z',
    resources: {
      upstreams: [],
      services: [],
      routes: [],
      streamRoutes: [],
      consumers: [
        {
          username: 'alice',
          desc: 'imported consumer',
          create_time: 1,
          update_time: 2,
        },
      ],
      credentials: [
        {
          username: 'alice',
          id: 'alice/credentials/key-auth-main',
          plugins: { 'key-auth': { key: 'secret-reference' } },
          create_time: 1,
          update_time: 2,
        },
      ],
      consumerGroups: [],
      ssls: [],
      globalRules: [],
      pluginConfigs: [],
      pluginMetadata: [],
      protos: [],
      secrets: [
        {
          manager: 'vault',
          id: 'vault-secret',
          uri: 'http://vault:8200',
          prefix: 'apisix',
          token: 'root',
          create_time: 1,
          update_time: 2,
        },
      ],
    },
  };
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const records = new Map<string, Record<string, unknown>>();

  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && records.has(path)) {
      await route.fulfill({ json: { value: records.get(path), key: path.replace('/apisix/admin', '/apisix') } });
      return;
    }
    if (request.method() === 'GET' && /\/(consumers\/alice(?:\/credentials\/key-auth-main)?|secrets\/vault\/vault-secret)$/.test(new URL(request.url()).pathname)) {
      await route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
      return;
    }
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      const id = path.split('/').at(-1)!;
      const value = path === '/apisix/admin/consumers/alice' ? body : { ...body, id };
      records.set(path, value);
      requests.push({
        url: new URL(request.url()).pathname,
        body: request.postDataJSON() as Record<string, unknown>,
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ value, key: path.replace('/apisix/admin', '/apisix') }),
      });
      return;
    }
    await route.fulfill({ json: { list: [], total: 0 } });
  });

  await page.goto('export_import');
  await expect(
    page.getByRole('heading', { name: 'Import / Export' })
  ).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'apisix-import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exportData)),
  });

  await expect(page.getByText('apisix-import.json')).toBeVisible();
  await expect(page.getByLabel('Consumers (1)')).toBeChecked();
  await expect(page.getByLabel('Consumer Credentials (1)')).toBeChecked();
  await expect(page.getByLabel('Secrets (1)')).toBeChecked();

  await page.getByRole('button', { name: 'Import Selected Resources' }).click();
  await page
    .getByRole('dialog', { name: 'Confirm Import' })
    .getByRole('button', { name: 'Import', exact: true })
    .click();

  await expect(
    page.getByText('Import Complete: 3 succeeded, 0 failed')
  ).toBeVisible();
  expect(requests).toEqual([
    {
      url: '/apisix/admin/consumers/alice',
      body: { username: 'alice', desc: 'imported consumer' },
    },
    {
      url: '/apisix/admin/consumers/alice/credentials/key-auth-main',
      body: { plugins: { 'key-auth': { key: 'secret-reference' } } },
    },
    {
      url: '/apisix/admin/secrets/vault/vault-secret',
      body: {
        uri: 'http://vault:8200',
        prefix: 'apisix',
        token: 'root',
      },
    },
  ]);
});
