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
import { streamRoutesPom } from '@e2e/pom/stream_routes';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import {
  uiCheckStreamRouteRequiredFields,
  uiFillStreamRouteRequiredFields,
} from '@e2e/utils/ui/stream_routes';
import {
  uiFillUpstreamRequiredFields,
  uiOpenInlineUpstream,
} from '@e2e/utils/ui/upstreams';
import { expect } from '@playwright/test';

import { deleteAllStreamRoutes } from '@/apis/stream_routes';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await deleteAllStreamRoutes(e2eReq);
});

test('CRUD stream route with all fields', async ({ page }) => {
  test.setTimeout(120000);

  // Navigate to stream routes page
  await streamRoutesPom.toIndex(page);
  await expect(page.getByRole('heading', { name: 'Stream Routes' })).toBeVisible();

  // Navigate to add page
  await streamRoutesPom.toAdd(page);
  await expect(page.getByRole('heading', { name: 'Add Stream Route' })).toBeVisible({ timeout: 30000 });

  // Use unique server addresses to avoid collisions when running tests in parallel
  const uniqueId = randomId('test');
  const dnsSafeUniqueId = uniqueId.replace(/[^a-zA-Z0-9-]/g, '-');
  const uniqueIpSuffix = parseInt(uniqueId.slice(-6), 36) % 240 + 10; // 10-249
  const streamRouteData = {
    server_addr: `127.0.0.${uniqueIpSuffix}`,
    server_port: 9100 + parseInt(uniqueId.slice(-4), 36) % 1000, // Unique port
    remote_addr: '192.168.10.0/24',
    sni: `edge-${dnsSafeUniqueId}.example.com`,
    desc: `Stream route with optional fields - ${uniqueId}`,
    labels: {
      env: 'production',
      version: '2.0',
      region: 'us-west',
    },
  } as const;

  await uiFillStreamRouteRequiredFields(page, streamRouteData);

  // Fill upstream nodes manually
  await uiOpenInlineUpstream(page);
  const upstreamSection = page.getByRole('group', {
    name: 'Inline Upstream target',
  });
  await uiFillUpstreamRequiredFields(upstreamSection, {
    name: 'stream-route-full-upstream',
    nodes: [{ host: '127.0.0.11', port: 8081, weight: 100 }],
  });

  const submitButton = page
    .locator('form')
    .getByRole('button', { name: 'Add', exact: true });
  await expect(submitButton).toBeEnabled();
  await expect(submitButton).toHaveText('Add');
  expect(
    await submitButton.evaluate((button) => ({
      disabled: (button as HTMLButtonElement).disabled,
      type: (button as HTMLButtonElement).type,
    }))
  ).toEqual({ disabled: false, type: 'submit' });
  const createResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/apisix/admin/stream_routes') &&
      response.request().method() === 'POST',
    { timeout: 30000 }
  );
  await submitButton.click();
  const response = await createResponse;
  const created = await response.json();
  expect(response.ok(), created.error_msg ?? 'Stream Route creation must succeed').toBe(true);
  expect(created).toHaveProperty('value.id');
  await streamRoutesPom.isDetailPage(page);
  const streamRouteId = await page
    .getByRole('textbox', { name: 'ID', exact: true })
    .inputValue();

  // Verify initial values in detail view
  await uiCheckStreamRouteRequiredFields(page, streamRouteData);

  await uiCheckStreamRouteRequiredFields(page, streamRouteData);

  // Edit fields - update description, add a label, and modify server settings
  const updatedIpSuffix = (uniqueIpSuffix + 100) % 240 + 10;
  const updatedData = {
    server_addr: `127.0.0.${updatedIpSuffix}`,
    server_port: 9200 + parseInt(uniqueId.slice(-4), 36) % 1000, // Unique port
    remote_addr: '10.10.0.0/16',
    sni: `edge-updated-${dnsSafeUniqueId}.example.com`,
    desc: `Updated stream route with optional fields - ${uniqueId}`,
    labels: {
      ...streamRouteData.labels,
      updated: 'true',
    },
  } as const;

  await page
    .getByLabel('Server Address', { exact: true })
    .fill(updatedData.server_addr);
  await page
    .getByLabel('Server Port', { exact: true })
    .fill(updatedData.server_port.toString());
  await page.getByLabel('Remote Address').fill(updatedData.remote_addr);
  await page.getByLabel('SNI').fill(updatedData.sni);
  await page.getByLabel('Description').first().fill(updatedData.desc);

  await uiFillStreamRouteRequiredFields(page, {
    labels: { updated: 'true' },
  });
  await page.keyboard.press('Escape').catch(() => {});

  // Submit edit and return to detail page
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Review Changes Before Saving' })
    .getByRole('button', { name: 'Confirm & Save' })
    .click();
  await uiHasToastMsg(page, {
    hasText: 'Stream Route saved and reloaded from APISIX',
  });
  await streamRoutesPom.isDetailPage(page);

  // Verify updated values from detail view
  await uiCheckStreamRouteRequiredFields(page, updatedData);

  // Navigate back to index and locate the updated row
  await streamRoutesPom.toIndex(page);
  const updatedRow = page
    .getByRole('row')
    .filter({ hasText: updatedData.server_addr });
  await expect(updatedRow).toBeVisible({ timeout: 10000 }); // Longer timeout for parallel tests

  // View detail page from the list to double-check values
  await page.getByRole('link', { name: streamRouteId, exact: true }).click();
  await streamRoutesPom.isDetailPage(page);
  await uiCheckStreamRouteRequiredFields(page, updatedData);

  // Delete from detail page
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/stream_routes'));

  await streamRoutesPom.isIndexPage(page);
  await expect(
    page.getByRole('row').filter({ hasText: updatedData.server_addr })
  ).toHaveCount(0);
});
