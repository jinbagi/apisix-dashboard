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
import { expect, type Page, test } from '@playwright/test';

const description = 'Define how incoming requests are matched, transformed, and forwarded.';
async function setup(page: Page) {
  const rows = Array.from({ length: 14 }, (_, index) => ({ id: `route-${index}`, name: `Fixture route ${index}`, uri: `/fixture/${index}/*`, status: 1 }));
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('header-reflow-fixture')));
  await page.route('**/apisix/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/apisix/admin', '');
    if (route.request().method() !== 'GET') writes.push(path);
    if (path === '/routes') return route.fulfill({ json: { list: rows.map((value) => ({ value })), total: rows.length } });
    if (path.startsWith('/routes/route-')) return route.fulfill({ json: { value: rows.find((row) => path === `/routes/${row.id}`) } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('routes?page=1');
  await expect(page.getByRole('heading', { name: 'Routes', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return writes;
}
const routesHeader = (page: Page) => page.locator('.app-shell-content > div').filter({ has: page.getByRole('heading', { name: 'Routes', exact: true }) }).first();
async function assertReadable(page: Page) {
  const header = routesHeader(page);
  const title = await header.getByRole('heading', { name: 'Routes', exact: true }).boundingBox();
  const desc = await header.getByText(description, { exact: true }).boundingBox();
  expect(title!.height).toBeLessThan(48);
  expect(desc!.width).toBeGreaterThan(240);
  expect(desc!.height).toBeLessThan(85);
  expect((await header.boundingBox())!.height).toBeLessThan(250);
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  for (const action of [header.getByRole('button', { name: 'Preview request matching', exact: true }), header.getByRole('button', { name: 'Check route overlaps', exact: true }), header.getByRole('link', { name: 'Add Route', exact: true })]) {
    const rect = await action.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await expect(action).toBeInViewport({ ratio: 1 });
  }
}

for (const width of [390, 645, 800, 960, 1440]) test(`Routes header reflows real action controls at ${width}px after RAW minimizing`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1011 });
  const writes = await setup(page);
  await page.getByRole('button', { name: 'Raw', exact: true }).first().click();
  const raw = page.getByRole('dialog', { name: /Route: Fixture route/ });
  await expect(raw.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await raw.getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect(raw).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toBeHidden();
  await page.screenshot({ path: test.info().outputPath(`header-${width}.png`), animations: 'disabled' });
  await assertReadable(page);
  const preview = routesHeader(page).getByRole('button', { name: 'Preview request matching', exact: true });
  await preview.focus(); await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Request matching preview', exact: true }).getByRole('button', { name: 'Close request preview', exact: true }).click();
  await expect(preview).toBeFocused();
  expect(writes).toEqual([]);
});

test('content width drives reflow when the sidebar expands and page back controls stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 1011 });
  const writes = await setup(page);
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await assertReadable(page);
  await routesHeader(page).getByRole('link', { name: 'Add Route', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Go back', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Go back', exact: true }).press('Enter');
  await assertReadable(page);
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await assertReadable(page);
  expect(writes).toEqual([]);
});