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

const routes = Array.from({ length: 18 }, (_, i) => ({ key: `/apisix/routes/r${i}`, value: { id: `r${i}`, uri: `/r${i}`, status: 1, create_time: 1, update_time: 1 } }));

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`the page size select closes and reopens with ${reducedMotion} motion`, async ({ page, baseURL }) => {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      localStorage.setItem('settings:adminKey', JSON.stringify('reduced-motion-fixture'));
    });
    await page.route('**/apisix/admin/**', (request) => request.fulfill({
      json: new URL(request.request().url()).pathname.endsWith('/routes') ? { total: 18, list: routes.slice(0, 10) } : { list: [], total: 0 },
    }));
    await page.goto(`${baseURL}routes`);
    const changer = page.locator('.ant-pagination-options .ant-select');

    await changer.click();
    await page.getByRole('heading', { name: 'Routes', exact: true }).click();
    await expect(page.getByTitle('50 / page')).toBeHidden();

    await changer.click();
    await page.getByTitle('50 / page').click();
    await expect(page).toHaveURL(/page_size=50/);
  });
}
