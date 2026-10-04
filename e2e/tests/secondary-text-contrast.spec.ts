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

const routeValue = {
  id: 'contrast-route', name: 'Production API', uri: '/api/*', status: 1,
  desc: 'Routes external requests to the public API.',
  upstream: { type: 'roundrobin', nodes: { 'api.example.test:8080': 1 } },
  create_time: 1791090000, update_time: 1791090000,
};

async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const rgba = (value: string): number[] => {
      const numbers = value.match(/[\d.]+/g)?.map(Number);
      if (!numbers || numbers.length < 3) throw new Error(`Unsupported color: ${value}`);
      const scale = value.startsWith('color(srgb ') ? 255 : 1;
      return [numbers[0] * scale, numbers[1] * scale, numbers[2] * scale, numbers[3] ?? 1];
    };
    const composite = (front: number[], back: number[]) => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return [0, 1, 2].map(i => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha).concat(alpha);
    };
    const luminance = (color: number[]) => color.slice(0, 3).map(value => value / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const layers: number[][] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none' || style.opacity !== '1') throw new Error('This assertion needs a solid, unmasked text surface.');
      layers.unshift(rgba(style.backgroundColor));
    }
    const background = layers.reduce((back, front) => composite(front, back), [255, 255, 255, 1]);
    const color = getComputedStyle(element).color;
    const foreground = composite(rgba(color), background);
    const [bright, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return { text: element.textContent, color, background, ratio: (bright + 0.05) / (dark + 0.05) };
  });
}

async function readable(locator: Locator) {
  await expect(locator).toBeVisible();
  const result = await contrast(locator);
  expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(4.5);
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), animations: 'disabled', fullPage: true });
}

async function checkSidebar(page: Page, width: number) {
  if (width < 768) return;
  await readable(page.locator('.ant-menu-item-group-title').filter({ hasText: 'Overview' }));
  await readable(page.locator('.ant-menu-item-group-title').filter({ hasText: 'Traffic' }));
}

for (const mode of ['light', 'dark'] as const) {
  const disabledColor = mode === 'dark' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)';
  for (const width of [1440, 390]) {
    test(`${mode} normal secondary text remains readable at ${width}px without recoloring disabled controls`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1024 });
      await page.addInitScript(mode => {
        localStorage.setItem('settings:adminKey', JSON.stringify('contrast-fixture'));
        localStorage.setItem('theme', JSON.stringify(mode));
      }, mode);
      const writes: string[] = [];
      await page.route('**/apisix/admin/**', request => {
        const path = new URL(request.request().url()).pathname.replace('/apisix/admin', '');
        if (request.request().method() !== 'GET') { writes.push(path); return request.abort(); }
        if (path === '/routes') return request.fulfill({ json: { list: [{ value: routeValue }], total: 1 } });
        if (path === '/routes/contrast-route') return request.fulfill({ json: { value: routeValue } });
        if (path === '/plugins/list') return request.fulfill({ json: [] });
        if (path === '/plugins') return request.fulfill({ json: {} });
        return request.fulfill({ json: { list: [], total: 0 } });
      });
      const prefix = `${mode}-${width}`;
      await page.goto('routes');
      await page.getByRole('link', { name: 'Production API', exact: true }).waitFor();
      await capture(page, `${prefix}-routes`);
      await readable(page.getByText('Define how incoming requests are matched, transformed, and forwarded.', { exact: true }));
      await readable(page.locator('.resource-table-field > label').filter({ hasText: /^Search$/ }));
      await checkSidebar(page, width);
      const input = page.getByRole('searchbox', { name: 'Search', exact: true });
      expect(await input.evaluate(element => getComputedStyle(element, '::placeholder').color)).toBe(disabledColor);
      const descriptionToken = await input.evaluate(element => getComputedStyle(element).getPropertyValue('--ant-color-text-description').replace(/\s/g, ''));
      expect(descriptionToken).toBe(mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)');

      await page.getByRole('button', { name: 'Raw', exact: true }).first().click();
      const drawer = page.getByRole('dialog', { name: /Route: Production API/ });
      await expect(drawer.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
      await capture(page, `${prefix}-raw`);
      await readable(drawer.getByText('/routes/contrast-route', { exact: true }));
      await readable(drawer.getByText('No pending changes', { exact: true }));
      const save = drawer.getByRole('button', { name: 'Save Changes', exact: true });
      await expect(save).toBeDisabled();
      await expect(save).toHaveCSS('color', disabledColor);
      await expect(page.locator('.ant-drawer-mask')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.45)');

      await page.goto('dashboard');
      await expect(page.getByRole('link', { name: 'Production API', exact: true }).first()).toBeVisible();
      await capture(page, `${prefix}-dashboard`);
      await readable(page.getByText('Gateway configuration and operational overview', { exact: true }));
      await readable(page.getByText('Across available collections', { exact: true }));
      await readable(page.getByText('No active warnings', { exact: true }));
      await readable(page.getByText('Latest 10', { exact: true }));
      expect(writes).toEqual([]);
    });
  }
}