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

const id = 'route-' + 'a'.repeat(58);
async function openLongReview(page: Page) {
  const writes: string[] = [];
  const before = { id, uri: '/before', labels: Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`field_${index}`, 'Before'])), tail_marker: 'Before final field' };
  const after = { ...before, uri: '/after', labels: Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`field_${index}`, 'After'])), tail_marker: 'After final field' };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('review-modal-fixture')));
  await page.route('**/apisix/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/apisix/admin', '');
    if (route.request().method() !== 'GET') writes.push(path);
    if (path === `/routes/${id}`) return route.fulfill({ json: { value: before } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('export_import');
  await page.locator('input[type="file"]').setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 3, exportedAt: '2026-10-04T00:00:00Z', resources: { routes: [after] } })) });
  await page.getByRole('button', { name: 'Import Selected Resources', exact: true }).click();
  const parent = page.getByRole('dialog', { name: 'Confirm Import', exact: true });
  const trigger = parent.getByRole('button', { name: 'Compare JSON', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Import JSON comparison', exact: true });
  await expect(dialog.locator('.monaco-diff-editor')).toBeVisible();
  await expect(dialog).not.toHaveClass(/ant-zoom-enter|ant-zoom-appear/);
  await page.evaluate(() => document.fonts.ready);
  return { dialog, trigger, writes };
}

for (const viewport of [{ width: 390, height: 640 }, { width: 390, height: 844 }, { width: 960, height: 720 }]) {
  test(`shared review keeps actions visible and the entire JSON reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { dialog, trigger, writes } = await openLongReview(page);
    const confirm = dialog.getByRole('button', { name: 'Back to import preview', exact: true });
    const cancel = dialog.getByRole('button', { name: 'Keep editing', exact: true });
    await page.screenshot({ path: test.info().outputPath(`review-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
    for (const action of [confirm, cancel]) await expect(action).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(dialog.locator('p')).toContainText(`/routes/${id}`);
    const footer = (await confirm.boundingBox())!;
    const editor = dialog.locator('.modified-in-monaco-diff-editor');
    await editor.getByRole('textbox').focus();
    await page.keyboard.press('ControlOrMeta+End');
    await expect(editor.locator('.view-lines:not(.line-delete)')).toContainText('After final field');
    await expect(confirm).toBeInViewport({ ratio: 1 });
    expect((await confirm.boundingBox())!.y).toBeCloseTo(footer.y, 0);
    await cancel.focus(); await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused(); expect(writes).toEqual([]);
    await trigger.press('Enter'); await expect(dialog).toBeVisible();
    await confirm.focus(); await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden(); expect(writes).toEqual([]);
  });
}