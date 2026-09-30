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
import { randomInt } from 'node:crypto';

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

test('CRUD stream route with required fields', async ({ page }) => {
  // Navigate to stream routes page
  await streamRoutesPom.toIndex(page);
  await expect(page.getByRole('heading', { name: 'Stream Routes' })).toBeVisible();

  // Navigate to add page
  await streamRoutesPom.toAdd(page);
  await expect(page.getByRole('heading', { name: 'Add Stream Route' })).toBeVisible({ timeout: 30000 });

  // Use unique server addresses to avoid collisions when running tests in parallel
  const uniqueId = randomId('test');
  const uniqueIpSuffix = randomInt(10, 250);
  const portOffset = randomInt(0, 1000);
  const streamRouteData = {
    server_addr: `127.0.1.${uniqueIpSuffix}`,
    server_port: 9000 + portOffset, // Unique port
  };

  // Fill required fields
  await uiFillStreamRouteRequiredFields(page, streamRouteData);

  // Fill upstream nodes manually
  await uiOpenInlineUpstream(page);
  const upstreamSection = page.getByRole('group', {
    name: 'Inline Upstream target',
  });
  await uiFillUpstreamRequiredFields(upstreamSection, {
    name: 'stream-route-required-upstream',
    nodes: [{ host: '127.0.0.2', port: 8080, weight: 1 }],
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
  const responsePayload = await response.json();
  expect(response.ok(), JSON.stringify(responsePayload)).toBeTruthy();
  expect(responsePayload).toHaveProperty('value.id');
  await streamRoutesPom.isDetailPage(page);
  const streamRouteId = await page
    .getByRole('textbox', { name: 'ID', exact: true })
    .inputValue();

  // Verify created values in detail view
  await uiCheckStreamRouteRequiredFields(page, streamRouteData);

  // Verify pre-filled values
  await uiCheckStreamRouteRequiredFields(page, streamRouteData);

  // Edit fields - add description and labels
  const updatedData = {
    ...streamRouteData,
    desc: `Updated stream route description - ${uniqueId}`,
    labels: {
      env: 'test',
      version: '1.0',
    },
  };

  await uiFillStreamRouteRequiredFields(page, {
    desc: updatedData.desc,
    labels: updatedData.labels,
  });

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

  // Verify updated values on detail page
  await uiCheckStreamRouteRequiredFields(page, updatedData);

  // Navigate back to index and ensure the row exists
  await streamRoutesPom.toIndex(page);
  const row = page.getByRole('row').filter({ hasText: streamRouteData.server_addr });
  await expect(row.first()).toBeVisible({ timeout: 10000 }); // Longer timeout for parallel tests

  // View detail page from the list
  await row
    .first()
    .getByRole('link', { name: streamRouteId, exact: true })
    .click();
  await streamRoutesPom.isDetailPage(page);
  await uiCheckStreamRouteRequiredFields(page, updatedData);

  // Delete from the detail page
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/stream_routes'));

  await streamRoutesPom.isIndexPage(page);
  await expect(
    page.getByRole('row').filter({ hasText: streamRouteData.server_addr })
  ).toHaveCount(0);
});
