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
import { expect, type Locator, type Page, test } from '@playwright/test';

import { textContrast } from '../utils/textContrast';

async function measure(locator: Locator, placeholder = false) {
  await expect(locator).toBeVisible();
  await locator.evaluate(async element => {
    const animations: Animation[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) animations.push(...node.getAnimations());
    await Promise.all(animations.filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)));
  });
  return textContrast(locator, placeholder);
}

async function readable(locator: Locator, placeholder = false) {
  const result = await measure(locator, placeholder);
  expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(4.5);
  return result;
}

function unchangedDisabled(result: Awaited<ReturnType<typeof measure>>, color: string, background: number) {
  expect(result.color).toBe(color);
  for (const channel of result.background.slice(0, 3)) expect(channel).toBeCloseTo(background, 3);
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
}

for (const mode of ['light', 'dark'] as const) {
  const disabledColor = mode === 'light' ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.25)';
  const disabledBackground = mode === 'light' ? 244.8 : 38.8;
  const inputColor = mode === 'light' ? 'rgba(0, 0, 0, 0.88)' : 'rgba(255, 255, 255, 0.85)';
  for (const width of [1440, 390]) {
    test(`${mode} enabled placeholders remain readable and distinct at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1024 });
      await page.addInitScript(mode => {
        localStorage.setItem('settings:adminKey', JSON.stringify('placeholder-fixture'));
        localStorage.setItem('theme', JSON.stringify(mode));
      }, mode);
      const writes: string[] = [];
      await page.route('**/apisix/admin/**', route => {
        if (route.request().method() !== 'GET') { writes.push(route.request().method()); return route.abort(); }
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/plugins/list')) return route.fulfill({ json: [] });
        if (path.endsWith('/plugins')) return route.fulfill({ json: {} });
        return route.fulfill({ json: { list: [], total: 0 } });
      });
      const prefix = `${mode}-${width}`;
      await page.goto('routes');
      const search = page.getByRole('searchbox', { name: 'Search', exact: true });
      await expect(search).toBeEnabled();
      const searchHint = await readable(search, true);
      const label = await readable(page.locator('.resource-table-field > label').filter({ hasText: /^Search$/ }));
      expect(searchHint.ratio).toBeLessThan(label.ratio);
      await search.focus();
      await expect(search).toBeFocused();
      await readable(search, true);
      await search.pressSequentially('fixture');
      await expect(search).toHaveValue('fixture');
      expect((await readable(search)).ratio).toBeGreaterThan(searchHint.ratio);
      await expect(search).toHaveCSS('color', inputColor);
      await search.fill('');
      const views = page.getByRole('combobox', { name: 'Saved views', exact: true });
      await expect(views).toBeEnabled();
      await readable(page.locator('.resource-table-saved-select .ant-select-placeholder'));
      await capture(page, `${prefix}-routes`);

      await page.goto('ssls/add');
      const sni = page.getByRole('textbox', { name: 'SNI', exact: true });
      const snis = page.getByRole('combobox', { name: 'SNIs', exact: true });
      const snisContainer = snis.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]');
      await expect(page.getByText('SNI', { exact: true })).toBeVisible();
      await expect(page.getByText('SNIs', { exact: true })).toBeVisible();
      const sniHint = await readable(sni, true);
      await readable(snisContainer.locator('.ant-select-placeholder'));
      await sni.focus();
      await expect(sni).toBeFocused();
      await sni.pressSequentially('fixture.example');
      expect((await readable(sni)).ratio).toBeGreaterThan(sniHint.ratio);
      await expect(sni).toHaveCSS('color', inputColor);
      await expect(snis).toBeDisabled();
      unchangedDisabled(await measure(snisContainer.locator('.ant-select-placeholder')), disabledColor, disabledBackground);
      await capture(page, `${prefix}-disabled-select`);
      await sni.fill('');
      await expect(snis).toBeEnabled();
      await readable(snisContainer.locator('.ant-select-placeholder'));
      await snis.focus();
      await expect(snis).toBeFocused();
      await snis.fill('fixture.example');
      await snis.press('Enter');
      await expect(snisContainer.getByText('fixture.example', { exact: true })).toBeVisible();
      await expect(sni).toBeDisabled();
      unchangedDisabled(await measure(sni, true), disabledColor, disabledBackground);
      await capture(page, `${prefix}-disabled-input`);

      page.once('dialog', dialog => dialog.accept());
      await page.goto('export_import');
      await page.getByRole('button', { name: 'Prepare redacted copy', exact: true }).click();
      const modal = page.getByRole('dialog', { name: 'Prepare a sharing copy', exact: true });
      await modal.locator('input[type=file]').setInputFiles({ name: 'fixture.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ version: 3, exportedAt: '2026-10-04T00:00:00Z', resources: { routes: [{ id: 'one', uri: '/' }] } })) });
      await expect(modal.getByText('Custom field names (comma or newline separated; exact names, case insensitive)', { exact: true })).toBeVisible();
      await expect(modal).not.toHaveClass(/ant-zoom-(appear|enter)/);
      await expect(modal).toHaveCSS('opacity', '1');
      const area = modal.getByRole('textbox', { name: 'Custom sensitive field names', exact: true });
      const areaHint = await readable(area, true);
      await area.focus();
      await expect(area).toBeFocused();
      await area.pressSequentially('fixture_field');
      expect((await readable(area)).ratio).toBeGreaterThan(areaHint.ratio);
      await expect(area).toHaveCSS('color', inputColor);
      await area.fill('');
      await readable(modal.getByRole('searchbox', { name: 'Filter sensitive field paths', exact: true }), true);
      await capture(page, `${prefix}-textarea`);
      expect(writes).toEqual([]);
    });
  }
}
