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
import { uiGetMonacoEditor } from '@e2e/utils/ui';
import { expect, type Page, test } from '@playwright/test';

async function setup(page: Page, allowWrite = false) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const records = new Map<string, Record<string, unknown>>();
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('ssl-tag-fixture')));
  await page.route('**/apisix/admin/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    if (request.method() !== 'GET') {
      writes.push({ path, body: request.postDataJSON() });
      if (!allowWrite || request.method() !== 'PUT') return route.abort();
      const value = { ...request.postDataJSON(), id: path.split('/').at(-1) };
      records.set(path, value);
      return route.fulfill({ json: { value, key: `/apisix${path}` } });
    }
    if (records.has(path)) return route.fulfill({ json: { value: records.get(path), key: `/apisix${path}` } });
    if (path.startsWith('/ssls/')) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    const list = [...records].filter(([key]) => key.startsWith(`${path}/`)).map(([, value]) => ({ value }));
    return route.fulfill({ json: { list, total: list.length } });
  });
  await page.goto('ssls/add');
  return writes;
}
const snisField = (page: Page) => page.locator('[data-form-field="snis"]');
const tags = (page: Page) => snisField(page).locator('.ant-select-selection-item-content');
async function payload(page: Page) {
  await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
  await uiGetMonacoEditor(page, page.getByRole('tabpanel', { name: 'Payload JSON' }), false);
  return page.evaluate(() => JSON.parse(window.__monacoEditor__!.getModel()!.getValue()) as Record<string, unknown>);
}
async function enterTag(page: Page, value: string) {
  const input = page.getByRole('combobox', { name: 'SNIs', exact: true });
  await input.fill(value);
  await input.press('Enter');
  await expect(tags(page).filter({ hasText: value })).toBeVisible();
}
async function capture(page: Page, name: string) {
  await page.keyboard.press('Escape');
  const section = page.locator('.form-section[data-label="Server Names"]');
  await page.evaluate(() => document.fonts.ready);
  await section.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const box = await section.boundingBox();
  expect(box).not.toBeNull();
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), clip: box!, animations: 'disabled' });
}

for (const width of [1440, 390]) {
  test(`SNI to SNIs keeps committed tags and moves focus on Tab and Shift+Tab at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes = await setup(page);
    const sni = page.getByRole('textbox', { name: 'SNI', exact: true });
    const input = page.getByRole('combobox', { name: 'SNIs', exact: true });
    await sni.fill('first.example');
    await expect(input).toBeDisabled();
    await sni.fill('');
    await expect(input).toBeEnabled();
    await enterTag(page, 'fixture.example');
    await expect(sni).toBeDisabled();
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await input.press('Tab');
    await expect(input).not.toBeFocused();
    await expect(tags(page)).toHaveText(['fixture.example']);
    await expect(sni).toBeDisabled();
    await expect(page.getByText('A server certificate requires SNI or SNIs', { exact: true })).toHaveCount(0);
    await input.click();
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await input.press('Shift+Tab');
    await expect(input).not.toBeFocused();
    await expect(tags(page)).toHaveText(['fixture.example']);
    await capture(page, `ssl-tags-${width}`);
    const json = await payload(page);
    expect(json.snis).toEqual(['fixture.example']);
    expect(json).not.toHaveProperty('sni');
    expect(writes).toEqual([]);
  });
}

test('Tab and pointer blur commit pending text once without losing existing tags', async ({ page }) => {
  const writes = await setup(page);
  const input = page.getByRole('combobox', { name: 'SNIs', exact: true });
  await input.fill('one.example');
  await input.press('Tab');
  await expect(input).not.toBeFocused();
  await expect(tags(page)).toHaveText(['one.example']);
  await input.fill('two.example');
  await page.getByRole('textbox', { name: 'Description', exact: true }).click();
  await expect(tags(page)).toHaveText(['one.example', 'two.example']);
  await input.fill('two.example');
  await input.press('Tab');
  await expect(tags(page)).toHaveText(['one.example', 'two.example']);
  expect((await payload(page)).snis).toEqual(['one.example', 'two.example']);
  expect(writes).toEqual([]);
});

test('removing one of several tags and then the last preserves JSON and paired field validation', async ({ page }) => {
  const writes = await setup(page);
  const input = page.getByRole('combobox', { name: 'SNIs', exact: true });
  const sni = page.getByRole('textbox', { name: 'SNI', exact: true });
  await enterTag(page, 'one.example'); await enterTag(page, 'two.example'); await enterTag(page, 'three.example');
  await input.press('Tab');
  await snisField(page).locator('.ant-select-selection-item').filter({ hasText: 'two.example' }).locator('.ant-select-selection-item-remove').click();
  await expect(tags(page)).toHaveText(['one.example', 'three.example']);
  expect((await payload(page)).snis).toEqual(['one.example', 'three.example']);
  await page.getByRole('tab', { name: 'Visual Editor', exact: true }).click();
  await input.focus();
  await input.press('Backspace'); await expect(tags(page)).toHaveText(['one.example']);
  await input.press('Backspace'); await expect(tags(page)).toHaveCount(0);
  await expect(sni).toBeEnabled();
  await expect(page.getByText('A server certificate requires SNI or SNIs', { exact: true }).first()).toBeVisible();
  await sni.fill('single.example');
  await expect(input).toBeDisabled();
  await expect(page.getByText('A server certificate requires SNI or SNIs', { exact: true })).toHaveCount(0);
  const json = await payload(page);
  expect(json.sni).toBe('single.example'); expect(json).not.toHaveProperty('snis');
  expect(writes).toEqual([]);
});

test('keeps entered SSL tags in the exact custom-ID PUT payload and verified detail', async ({ page }) => {
  const writes = await setup(page, true);
  await page.getByRole('textbox', { name: 'ID', exact: true }).fill('ssl-tags-fixture');
  await page.getByRole('textbox', { name: 'Certificate 1', exact: true }).fill('fixture-certificate');
  await page.getByRole('textbox', { name: 'Private Key 1', exact: true }).fill('fixture-private-key');
  await enterTag(page, 'one.example'); await enterTag(page, 'two.example');
  await page.getByRole('combobox', { name: 'SNIs', exact: true }).press('Tab');
  await expect(tags(page)).toHaveText(['one.example', 'two.example']);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname.endsWith('/ssls'));
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ path: '/ssls/ssl-tags-fixture', body: { cert: 'fixture-certificate', key: 'fixture-private-key', snis: ['one.example', 'two.example'] } });
  expect(writes[0].body).not.toHaveProperty('id'); expect(writes[0].body).not.toHaveProperty('sni');
  await page.goto('ssls/detail/ssl-tags-fixture');
  await expect(tags(page)).toHaveText(['one.example', 'two.example']);
  await expect(page.getByRole('textbox', { name: 'SNI', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(1);
});


test('shared numeric tags retain their conversion through Enter, Tab and duplicate blur', async ({ page }) => {
  const writes = await setup(page);
  await page.goto('upstreams/add');
  await page.getByRole('switch', { name: 'Enable health checks', exact: true }).click();
  const field = page.locator('[data-form-field="checks.active.healthy.http_statuses"]');
  const input = field.getByRole('combobox', { name: 'HTTP Statuses', exact: true });
  const values = field.locator('.ant-select-selection-item-content');
  await input.fill('200'); await input.press('Enter');
  await expect(values).toHaveText(['200']);
  await input.fill('201'); await input.press('Tab');
  await expect(input).not.toBeFocused();
  await expect(values).toHaveText(['200', '201']);
  await input.fill('201');
  await page.getByRole('textbox', { name: 'Description', exact: true }).click();
  await expect(values).toHaveText(['200', '201']);
  const json = await payload(page);
  expect(json).toMatchObject({ checks: { active: { healthy: { http_statuses: [200, 201] } } } });
  expect(writes).toEqual([]);
});
