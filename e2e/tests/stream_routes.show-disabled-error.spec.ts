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

const disabledMessage = 'stream mode is disabled, can not add stream routes';

test('shows the disabled stream API response after navigation and refresh', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key'));
  });
  // Test error presentation without restarting the shared APISIX server or
  // assuming that every APISIX version rejects GET in HTTP-only mode.
  await page.route('**/apisix/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const disabled = path.endsWith('/stream_routes');
    await route.fulfill({
      status: disabled ? 400 : 200,
      contentType: 'application/json',
      body: JSON.stringify(disabled
        ? { error_msg: disabledMessage }
        : { list: [], total: 0 }),
    });
  });
  await page.goto('stream_routes');
  await expect(page.getByText(disabledMessage, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(disabledMessage, { exact: true })).toBeVisible();
});
