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

import { expect, type Locator, type Page, test } from '@playwright/test';

import { textContrast } from '../utils/textContrast';

const resource = { id: 'action-contrast', name: 'Contrast API', uri: '/api/*', status: 1,
  upstream: { type: 'roundrobin', nodes: { 'api.example.test:8080': 1 } } };
async function setup(page: Page, mode: 'light' | 'dark', width = 1440) {
  await page.setViewportSize({ width, height: 1024 });
  await page.addInitScript(mode => {
    localStorage.setItem('settings:adminKey', JSON.stringify('contrast-fixture'));
    localStorage.setItem('theme', JSON.stringify(mode));
  }, mode);
  const writes: string[] = [];
  await page.route('**/apisix/admin/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/apisix/admin', '');
    if (route.request().method() !== 'GET') { writes.push(path); return route.abort(); }
    if (path === '/routes') return route.fulfill({ json: { list: [{ value: resource }], total: 1 } });
    if (path === '/routes/action-contrast') return route.fulfill({ json: { value: resource } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('routes');
  await expect(page.getByRole('link', { name: 'Contrast API', exact: true })).toBeVisible();
  // Measure each final pointer state without sampling a partially interpolated transition.
  await page.addStyleTag({ content: '*,*::before,*::after{transition-duration:0s!important;animation-duration:0s!important}' });
  await page.evaluate(() => document.fonts.ready);
  return writes;
}
async function readable(locator: Locator) {
  await expect(locator).toBeVisible();
  const value = await textContrast(locator);
  expect(value.ratio, JSON.stringify(value)).toBeGreaterThanOrEqual(4.5);
  return value;
}
async function states(page: Page, locator: Locator) {
  const fixture = await locator.getAttribute('id');
  const captureState = async (state: string) => {
    if (fixture?.startsWith('contrast-')) await locator.screenshot({ path: test.info().outputPath(`${fixture}-${state}.png`) });
  };
  await locator.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const normal = await readable(locator);
  await captureState('default');
  await locator.hover();
  const hover = await readable(locator);
  await captureState('hover');
  await page.mouse.down();
  let active;
  try {
    expect(await locator.evaluate(element => element.matches(':active'))).toBe(true);
    active = await readable(locator);
    await captureState('active');
  } finally { await page.mouse.move(0, 0); await page.mouse.up(); }
  await page.keyboard.press('Tab'); await locator.focus();
  const focus = await readable(locator);
  expect(focus.focusVisible).toBe(true);
  await captureState('focus');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const readings = { normal, hover, active, focus };
  const name = (normal.text ?? 'action').trim().replace(/[^a-z0-9]+/gi, '-');
  await writeFile(test.info().outputPath(`${name}-contrast.json`), JSON.stringify(readings, null, 2));
  return readings;
}
async function selectedMenu(page: Page, width: number) {
  if (width >= 768) await states(page, page.locator('.ant-menu-item-selected').first());
}
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), animations: 'disabled', fullPage: true });
}
async function openDraft(page: Page) {
  await page.getByRole('button', { name: 'Raw', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: /Route: Contrast API/ });
  await expect(drawer.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  const save = drawer.getByRole('button', { name: 'Save Changes', exact: true });
  await expect(save).toBeDisabled();
  const disabled = await textContrast(save);
  await page.evaluate(() => {
    const editor = window.__monacoEditor__!;
    editor.setValue(JSON.stringify({ ...JSON.parse(editor.getValue()), desc: 'Unsaved contrast fixture' }, null, 2));
  });
  await expect(save).toBeEnabled();
  return { drawer, save, disabled };
}
async function fixtureVariants(save: Locator) {
  await save.evaluate(source => {
    const panel = document.createElement('div'); panel.id = 'contrast-variants';
    panel.style.cssText = 'position:fixed;left:20px;top:100px;z-index:99999;padding:12px;background:var(--ant-color-bg-container);display:flex;gap:10px;flex-direction:column';
    source.parentElement!.append(panel);
    // Native fixtures reuse the actual installed Button classes and global styles; no colors are injected.
    for (const variant of ['solid', 'filled', 'outlined', 'dashed', 'text', 'link', 'neutral', 'danger', 'disabled']) {
      const button = source.cloneNode(true) as HTMLButtonElement;
      button.id = `contrast-${variant}`; button.textContent = `Fixture ${variant}`; button.removeAttribute('aria-label');
      button.className = button.className.replace(/ant-btn-variant-\w+/, `ant-btn-variant-${['danger', 'disabled'].includes(variant) ? 'solid' : variant === 'neutral' ? 'outlined' : variant}`);
      if (variant === 'neutral') button.className = button.className.replace('ant-btn-color-primary', 'ant-btn-color-default');
      if (variant === 'danger') button.className = button.className.replace('ant-btn-color-primary', 'ant-btn-color-dangerous');
      button.disabled = variant === 'disabled'; panel.append(button);
    }
    const raw = document.querySelector<HTMLButtonElement>('.resource-table-raw .ant-btn')!.cloneNode(true) as HTMLButtonElement;
    raw.id = 'contrast-disabled-raw'; raw.textContent = 'Fixture disabled RAW'; raw.disabled = true;
    const rawCell = document.createElement('div'); rawCell.className = 'resource-table-raw';
    rawCell.append(raw); panel.append(rawCell);
  });
}
async function tokenColor(locator: Locator, token: string) {
  return locator.evaluate((element, token) => {
    const probe = document.createElement('span'); probe.style.color = getComputedStyle(element).getPropertyValue(token); element.append(probe);
    const color = getComputedStyle(probe).color; probe.remove(); return color;
  }, token);
}

for (const mode of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`${mode} RAW actions, selected tabs and success metrics remain readable at ${width}px`, async ({ page }) => {
      const writes = await setup(page, mode, width);
      await states(page, page.getByRole('button', { name: 'Raw', exact: true }).first());
      await selectedMenu(page, width);
      await capture(page, `${mode}-${width}-routes`);
      const { drawer, save, disabled } = await openDraft(page);
      expect(disabled.color).toBe(mode === 'dark' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)');
      await states(page, drawer.getByRole('tab', { selected: true }));
      const actual = await states(page, save);
      expect(actual.normal.color).toBe('rgb(255, 255, 255)'); expect(actual.hover.color).toBe(actual.normal.color);
      await states(page, drawer.getByRole('button', { name: 'Review changes', exact: true }));
      await capture(page, `${mode}-${width}-raw`);
      await page.goto('dashboard');
      const success = page.locator('[class*="snapshotValueSuccess"]');
      await expect(success).toHaveCount(2);
      const metrics = [];
      for (const item of await success.all()) metrics.push(await readable(item));
      await writeFile(test.info().outputPath('success-metrics-contrast.json'), JSON.stringify(metrics, null, 2));
      await capture(page, `${mode}-${width}-dashboard`);
      expect(writes).toEqual([]);
    });
  }

  test(`${mode} primary variants cover pointer and keyboard states without changing global or protected colors`, async ({ page }) => {
    const writes = await setup(page, mode);
    const { save, disabled } = await openDraft(page);
    await fixtureVariants(save);
    for (const variant of ['solid', 'filled', 'outlined', 'dashed', 'text', 'link', 'neutral']) await states(page, page.locator(`#contrast-${variant}`));
    const disabledFixture = await textContrast(page.locator('#contrast-disabled'));
    expect(disabledFixture.color).toBe(disabled.color); expect(disabledFixture.background).toEqual(disabled.background);
    await expect(page.locator('#contrast-disabled')).toBeDisabled();
    const disabledRaw = page.locator('#contrast-disabled-raw');
    await expect(disabledRaw).toBeDisabled();
    await expect(disabledRaw).toHaveCSS('color', await tokenColor(disabledRaw, '--ant-color-primary'));
    const danger = page.locator('#contrast-danger');
    await expect(danger).toHaveCSS('background-color', await tokenColor(danger, '--ant-color-error'));
    await expect(danger).toHaveCSS('color', 'rgb(255, 255, 255)');
    expect(await tokenColor(save, '--ant-color-primary')).toBe(mode === 'dark' ? 'rgb(85, 143, 216)' : 'rgb(37, 99, 235)');
    expect(await tokenColor(save, '--ant-color-success')).toBe(mode === 'dark' ? 'rgb(73, 170, 25)' : 'rgb(82, 196, 26)');
    await capture(page, `${mode}-button-variants`);
    expect(writes).toEqual([]);
  });
}
