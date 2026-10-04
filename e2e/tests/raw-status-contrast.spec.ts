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
import { writeFile } from 'node:fs/promises';

import { captureNativeViewport, nativeZoomContext, setNativeZoom, settledLayout } from '@e2e/utils/nativeBrowserZoom';
import { textContrast } from '@e2e/utils/textContrast';
import { expect, type Locator, type Page, test } from '@playwright/test';

const initial = { id: 'status-contrast', name: 'Status contrast API', uri: '/status/*', status: 1, create_time: 1791090000, update_time: 1791090000,
  upstream: { type: 'roundrobin', nodes: { 'fixture.example:8080': 1 } } };

async function readable(status: Locator) {
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('aria-live', 'polite');
  const result = await textContrast(status);
  expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(4.5);
  return result;
}

async function statusBrowser(defaultPage: Page, size: 1440 | 390 | 'native200') {
  if (typeof size === 'number') {
    await defaultPage.setViewportSize({ width: size, height: 1024 });
    return { page: defaultPage, zoom: async () => ({ viewport: size }), close: async () => {} };
  }
  const fixture = await nativeZoomContext();
  const page = fixture.context.pages()[0];
  return { page, zoom: () => setNativeZoom(page, fixture.worker, fixture.initialDpr), close: fixture.close };
}

for (const theme of ['light', 'dark'] as const) {
  const secondary = theme === 'dark' ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.65)';
  const disabled = theme === 'dark' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)';
  const dirtyColor = theme === 'dark' ? 'rgb(216, 150, 20)' : 'rgb(135, 77, 0)';
  const expectedPalette = theme === 'dark'
    ? { warning: '#d89614', 'warning-text': '#d89614', error: '#dc4446', primary: '#558fd8' }
    : { warning: '#faad14', 'warning-text': '#faad14', error: '#ff4d4f', primary: '#2563eb' };
  for (const size of [1440, 390, 'native200'] as const) {
    test(`RAW dirty and saving status contrast in ${theme} at ${size}`, async ({ page: defaultPage, baseURL }, info) => {
      const browser = await statusBrowser(defaultPage, size);
      const { page } = browser;
      const context = page.context();
      const origin = new URL(baseURL!).origin;
      let current: Record<string, unknown> = structuredClone(initial);
      const patches: unknown[] = []; const unexpected: string[] = [];
      let release = () => {};
      const held = new Promise<void>(resolve => { release = resolve; });
      const measurements: unknown[] = [];
      try {
        await context.addInitScript(theme => {
          localStorage.setItem('settings:adminKey', JSON.stringify('status-contrast-fixture-only'));
          localStorage.setItem('theme', JSON.stringify(theme));
        }, theme);
        await context.route('**/*', async route => {
          const request = route.request(); const url = new URL(request.url());
          if (url.origin !== origin) { unexpected.push(request.url()); return route.abort(); }
          if (!url.pathname.startsWith('/apisix/admin/')) return route.continue();
          const api = url.pathname.slice('/apisix/admin'.length);
          if (request.method() === 'PATCH' && api === '/routes/status-contrast') {
            const patch = request.postDataJSON(); patches.push(patch);
            await held;
            current = { ...current, ...patch };
            return route.fulfill({ json: { value: current, key: '/apisix/routes/status-contrast' } });
          }
          if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${api}`); return route.abort(); }
          if (api === '/routes') return route.fulfill({ json: { list: [{ value: current, key: '/apisix/routes/status-contrast' }], total: 1 } });
          if (api === '/routes/status-contrast') return route.fulfill({ json: { value: current, key: '/apisix/routes/status-contrast' } });
          if (api === '/plugins/list') return route.fulfill({ json: [] });
          if (api === '/plugins') return route.fulfill({ json: {} });
          return route.fulfill({ json: { list: [], total: 0 } });
        });
        await page.goto(new URL('routes', baseURL).href);
        await expect(page.getByRole('link', { name: initial.name, exact: true })).toBeVisible();
        measurements.push(await browser.zoom());
        await page.getByRole('button', { name: 'Raw', exact: true }).first().click();
        const raw = page.getByRole('dialog', { name: /Route: Status contrast API/ });
        const editor = raw.getByRole('textbox', { name: 'Editor content' });
        await expect(editor).toBeVisible(); await settledLayout(page);
        const clean = raw.getByText('No pending changes', { exact: true });
        measurements.push({ state: 'clean', ...await readable(clean) });
        await expect(clean).toHaveCSS('color', secondary);
        const save = raw.getByRole('button', { name: 'Save Changes', exact: true });
        await expect(save).toBeDisabled(); await expect(save).toHaveCSS('color', disabled);
        await page.evaluate(() => { const editor = window.__monacoEditor__!; editor.setValue(JSON.stringify({ ...JSON.parse(editor.getValue()), desc: 'Prepared contrast change' }, null, 2)); });
        const dirty = raw.getByText('Unsaved changes. Ctrl+S saves changed fields.', { exact: true });
        await expect(save).toBeEnabled(); await settledLayout(page);
        measurements.push({ state: 'dirty', ...await readable(dirty) });
        await expect(dirty).toHaveCSS('color', dirtyColor);
        // The local status rule must leave the installed global palette intact.
        const palette = await dirty.evaluate(node => {
          const style = getComputedStyle(node);
          return Object.fromEntries(['warning', 'warning-text', 'error', 'primary'].map(name => [name, style.getPropertyValue(`--ant-color-${name}`).trim()]));
        });
        expect(palette).toEqual(expectedPalette);
        await dirty.scrollIntoViewIfNeeded(); await expect(dirty).toBeInViewport({ ratio: 1 });
        const capture = async (state: string) => {
          const file = info.outputPath(`${theme}-${size}-${state}.png`);
          measurements.push(await captureNativeViewport(page, file));
        };
        await capture('dirty');
        await editor.focus(); await page.keyboard.press('ControlOrMeta+s');
        await expect.poll(() => patches.length).toBe(1);
        const saving = raw.getByText('Saving and verifying with APISIX...', { exact: true });
        await settledLayout(page);
        measurements.push({ state: 'saving', ...await readable(saving) });
        await expect(saving).toHaveCSS('color', dirtyColor);
        await saving.scrollIntoViewIfNeeded(); await expect(saving).toBeInViewport({ ratio: 1 });
        await capture('saving');
        release();
        const saved = raw.getByText(/^Saved at /);
        await expect(saved).toBeVisible(); await settledLayout(page);
        measurements.push({ state: 'saved', ...await readable(saved) });
        await expect(saved).toHaveCSS('color', secondary); await expect(save).toBeDisabled(); await expect(save).toHaveCSS('color', disabled);
        expect(patches).toEqual([{ desc: 'Prepared contrast change' }]); expect(unexpected).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await writeFile(info.outputPath(`${theme}-${size}-measurements.json`), JSON.stringify({ theme, size, palette, measurements, patches, unexpected }, null, 2));
      } finally { release(); await browser.close(); }
    });
  }
}
