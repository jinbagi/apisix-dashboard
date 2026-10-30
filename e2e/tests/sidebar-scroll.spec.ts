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

test('the sidebar menu scrolls to its last items on a short window', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1300, height: 600 });
  await page.addInitScript(() => {
    localStorage.setItem('settings:adminKey', JSON.stringify('sidebar-scroll-fixture'));
  });
  await page.route('**/apisix/admin/**', (request) => request.fulfill({ json: { list: [], total: 0 } }));
  await page.goto(`${baseURL}routes`);

  const nav = page.locator('.ant-layout-sider');
  const last = nav.getByRole('menuitem').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(nav.getByText('APISIX', { exact: true })).toBeInViewport();
});
