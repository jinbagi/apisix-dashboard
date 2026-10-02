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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key'));
  });
  await page.route('**/apisix/admin/**', async (route) => {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error_msg: 'upstream unavailable' }),
    });
  });
});

test('keeps dashboard collection failures in the inline partial-data state', async ({
  page,
}) => {
  await page.goto('dashboard');

  await expect(page.getByText('Partial gateway data')).toBeVisible();
  await expect(
    page.getByText('12 Admin API collections could not be loaded.')
  ).toBeVisible();
  await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
  const activityBadge = page
    .getByRole('button', { name: 'Activity Log' })
    .locator('xpath=..');
  await expect(activityBadge.locator('.ant-badge-count')).toHaveCount(0);
});

test('keeps topology failures in the inline recovery state', async ({
  page,
}) => {
  await page.goto('topology');

  await expect(page.getByText('Topology unavailable')).toBeVisible();
  await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
  const activityBadge = page
    .getByRole('button', { name: 'Activity Log' })
    .locator('xpath=..');
  await expect(activityBadge.locator('.ant-badge-count')).toHaveCount(0);
});

test('replaces a broken route detail form with the route error page', async ({
  page,
}) => {
  await page.goto('routes/detail/example-route');

  await expect(page.getByRole('heading', { name: 'Admin API request failed' }))
    .toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
});

test('does not expose secret actions when the detail cannot be loaded', async ({
  page,
}) => {
  await page.goto('secrets/detail/vault/example-secret');

  await expect(page.getByRole('heading', { name: 'Admin API request failed' }))
    .toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
});

test('explains when global search cannot reach any resource collection', async ({
  page,
}) => {
  await page.goto('dashboard');
  await expect(page.getByText('Partial gateway data')).toBeVisible();

  await page.getByRole('button', { name: 'Search resources' }).click();
  await page
    .getByRole('combobox', { name: 'Search all resources' })
    .fill('example');

  await expect(page.getByText('Search unavailable')).toBeVisible();
  await expect(
    page.getByText('Could not completely search:', { exact: false })
  ).toBeVisible();
  await expect(page.getByText('No results found')).toHaveCount(0);
  await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
});
