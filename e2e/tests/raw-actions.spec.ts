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

import { applyBulkPatch } from '@/apis/bulk-patch';

const initial = { id: 'actions', name: 'Catalog service', upstream_id: 'catalog-origin', desc: 'Before edit', create_time: 1, update_time: 1 };
async function openEditor(page: Page) {
  let value: Record<string, unknown> = { ...initial };
  const writes: Record<string, unknown>[] = [];
  const controls: { hold?: Promise<void> } = {};
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    if (path === '/services/actions') {
      if (request.method() === 'PATCH') { const patch = request.postDataJSON(); writes.push(patch); await controls.hold; value = applyBulkPatch(value, patch); }
      return route.fulfill({ json: { value } });
    }
    if (path === '/services') return route.fulfill({ json: { list: [{ value }], total: 1 } });
    if (path === '/upstreams/catalog-origin') return route.fulfill({ json: { value: { id: 'catalog-origin', nodes: { 'catalog.example:80': 1 } } } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('services');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Service: Catalog service' });
  await expect(drawer.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await page.evaluate(() => {
    const editor = window.__monacoEditor__!;
    editor.setValue(JSON.stringify({ ...JSON.parse(editor.getValue()), desc: 'Prepared change' }, null, 2));
  });
  await expect(drawer.getByRole('button', { name: 'Save Changes', exact: true })).toBeEnabled();
  return { drawer, writes, controls };
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 960, height: 900 }, { width: 390, height: 844 }]) {
  test(`RAW save actions stay together at the bottom with references at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const { drawer, writes } = await openEditor(page);
    const tools = drawer.getByRole('group', { name: 'RAW editor tools', exact: true });
    const primary = drawer.getByRole('group', { name: 'RAW save actions', exact: true });
    const save = primary.getByRole('button', { name: 'Save Changes', exact: true });
    const before = (await save.boundingBox())!;
    await tools.getByRole('button', { name: 'Related resources', exact: true }).click();
    await expect(drawer.getByRole('complementary', { name: 'Related resource inspector' }).getByLabel('Related resource JSON')).toContainText('catalog.example:80');
    for (const name of ['Related resources', 'Change history', 'Analyze impact', 'Drafts', 'Format', 'Copy', 'Reset']) await expect(tools.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    for (const name of ['Review changes', 'Save Changes']) await expect(primary.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    const after = (await save.boundingBox())!;
    const review = (await primary.getByRole('button', { name: 'Review changes', exact: true }).boundingBox())!;
    const toolsBox = (await tools.boundingBox())!;
    expect(after.y + after.height).toBeCloseTo(before.y + before.height, 0);
    expect(after.y).toBeCloseTo(review.y, 0);
    expect(toolsBox.y + toolsBox.height).toBeLessThanOrEqual(after.y);
    expect(toolsBox.height).toBeLessThanOrEqual(70);
    expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: info.outputPath(`raw-actions-${viewport.width}.png`), animations: 'disabled' });
    await drawer.getByRole('button', { name: 'Show guidance', exact: true }).click();
    await expect(save).toBeInViewport({ ratio: 1 });
    expect(writes).toEqual([]);
  });
}

test('RAW tool keyboard focus, dialogs, and explicit saving retain the primary action position', async ({ page }) => {
  const { drawer, controls, writes } = await openEditor(page);
  const tools = drawer.getByRole('group', { name: 'RAW editor tools', exact: true });
  const primary = drawer.getByRole('group', { name: 'RAW save actions', exact: true });
  await tools.getByRole('button', { name: 'Format', exact: true }).focus();
  await expect(page.getByRole('tooltip', { name: 'Format Admin API JSON', exact: true })).toBeVisible();
  await tools.getByRole('button', { name: 'Format', exact: true }).press('Tab');
  await expect(tools.getByRole('button', { name: 'Copy', exact: true })).toBeFocused();
  await expect(page.getByRole('tooltip', { name: 'Copy Admin API JSON', exact: true })).toBeVisible();
  await tools.getByRole('button', { name: 'Copy', exact: true }).press('Tab');
  await expect(tools.getByRole('button', { name: 'Reset', exact: true })).toBeFocused();
  await tools.getByRole('button', { name: 'Reset', exact: true }).press('Tab');
  await expect(primary.getByRole('button', { name: 'Review changes', exact: true })).toBeFocused();
  await primary.getByRole('button', { name: 'Review changes', exact: true }).press('Enter');
  const review = page.getByRole('dialog', { name: 'Review Changes Before Saving' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(primary.getByRole('button', { name: 'Review changes', exact: true })).toBeFocused();
  await tools.getByRole('button', { name: 'Drafts', exact: true }).click();
  const draft = page.getByRole('dialog', { name: 'Local RAW draft', exact: true });
  await expect(draft).toBeVisible();
  await draft.getByRole('button', { name: 'Close', exact: true }).last().click();
  await tools.getByRole('button', { name: 'Change history', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Resource change history', exact: true });
  await expect(history).toBeVisible();
  await history.getByRole('button', { name: 'Close history', exact: true }).click();
  expect(writes).toEqual([]);
  let release = () => {};
  controls.hold = new Promise<void>((resolve) => { release = resolve; });
  const save = primary.getByRole('button', { name: 'Save Changes', exact: true });
  const before = (await save.boundingBox())!;
  await save.press('Enter');
  await expect.poll(() => writes.length).toBe(1);
  await expect(drawer.getByText('Saving and verifying with APISIX...', { exact: true })).toBeVisible();
  const saving = (await save.boundingBox())!;
  expect(saving.x + saving.width).toBeCloseTo(before.x + before.width, 0);
  expect(saving.y + saving.height).toBeCloseTo(before.y + before.height, 0);
  release();
  await expect(drawer.getByText(/Saved at/)).toBeVisible();
  expect(writes).toEqual([{ desc: 'Prepared change' }]);
});
