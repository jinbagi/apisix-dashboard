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

const longId = 'resource-' + 'a'.repeat(55);
const longName = 'Catalog-' + 'long-name-'.repeat(9);
const longDomain = 'backend-' + 'a'.repeat(50) + '.example.test';
const longHost = longDomain + ':9443';
const longLabel = 'production-' + 'region'.repeat(20);
const pluginNames = ['ai-proxy-multi', 'response-rewrite', 'serverless-pre-function', 'prometheus'];
const value = {
  id: longId, name: longName, username: longName, desc: 'Description'.repeat(20),
  service_id: longId, upstream_id: longId, group_id: longId, manager: 'vault',
  uri: '/catalog/' + 'segment/'.repeat(24), host: longDomain, hosts: [longDomain],
  snis: [longDomain], sni: longDomain, server_addr: '2001:db8:1234:5678:abcd:ef01:2345:6789', server_port: 9443,
  remote_addr: '2001:db8:1234:5678:abcd:ef01:2345:6789',
  type: 'roundrobin', scheme: 'https', status: 1,
  plugins: Object.fromEntries(pluginNames.map(name => [name, {}])),
  labels: { environment: longLabel, owner: longLabel, cluster: longLabel },
  nodes: { [longHost]: 1, ['backup-' + longHost]: 1, 'spare.example.test:9443': 1 },
  field_path: 'Query.' + 'nestedField.'.repeat(6) + 'name', add_value: 2, mul_value: 3, mul_arguments: ['firstArgument', 'secondArgument'],
  content: 'syntax = "proto3";\nmessage ' + 'LongMessage'.repeat(20) + ' {}',
  validity_end: 2000000000, create_time: 1790982000, update_time: 1790982060,
};
const collections = ['routes', 'services', 'upstreams', 'consumers', 'consumer_groups', 'stream_routes', 'ssls', 'secrets', 'global_rules', 'plugin_configs', 'protos'];

async function setup(page: Page, baseURL: string, theme: 'light' | 'dark') {
  const unexpected: string[] = [];
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseURL).origin });
  await page.addInitScript(theme => {
    localStorage.setItem('settings:adminKey', JSON.stringify('table-overflow-fixture'));
    localStorage.setItem('theme', JSON.stringify(theme));
  }, theme);
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) { unexpected.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/apisix/admin/')) return route.continue();
    if (request.method() !== 'GET') { unexpected.push(request.method() + url.pathname); return route.abort(); }
    const path = url.pathname.replace('/apisix/admin/', '');
    if (collections.includes(path) || path === `consumers/${longName}/credentials` || path === `services/${longId}/graphql_cost_decorations`) return route.fulfill({ json: { list: [{ key: `/apisix/${path}/${longId}`, value: { ...value, ...(path === 'ssls' ? { type: 'server' } : {}) } }], total: 1 } });
    if (path === `consumers/${longName}` || path === `services/${longId}`) return route.fulfill({ json: { value } });
    if (path === 'plugins/list') return route.fulfill({ json: [] });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  return unexpected;
}

async function configure(page: Page, narrow: boolean) {
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Table view settings', exact: true });
  for (const checkbox of await settings.getByRole('checkbox').all()) if (await checkbox.isEnabled()) await checkbox.check();
  if (narrow) for (const width of await settings.getByRole('spinbutton').all()) {
    if (await width.isEnabled()) await width.fill((await width.getAttribute('min')) || '80');
  }
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(settings).toBeHidden();
}

async function cellViolations(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  return page.locator('.resource-table .ant-table').evaluate(table => {
    const errors: { column: string; text: string; kind: string; left: number; right: number }[] = [];
    const headers = [...table.querySelectorAll('thead th')].map(cell => cell.textContent?.trim() || '');
    const cells = [...table.querySelectorAll('tbody tr.ant-table-row > td, thead tr > th')];
    for (const cell of cells) {
      const box = cell.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const column = headers[Array.from(cell.parentElement!.children).indexOf(cell)] || 'selection';
      // Intersect with actual local clipping ancestors. Ellipsis is allowed; content
      // spilling into another column or clipped interactive controls is not.
      const clipped = (rect: DOMRect, element: Element) => {
        let left = rect.left, right = rect.right;
        for (let node: Element | null = element; node && node !== cell; node = node.parentElement) {
          if (/hidden|clip|auto|scroll/.test(getComputedStyle(node).overflowX)) {
            const clip = node.getBoundingClientRect(); left = Math.max(left, clip.left); right = Math.min(right, clip.right);
          }
        }
        return { left, right };
      };
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim() || !node.parentElement) continue;
        const style = getComputedStyle(node.parentElement);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          const visible = clipped(rect, node.parentElement);
          if (visible.right > visible.left && (visible.left < box.left - 1 || visible.right > box.right + 1)) errors.push({column, text: node.textContent.trim().slice(0, 100), kind: 'painted text', ...visible});
        }
      }
      for (const button of cell.querySelectorAll('button, input[type=checkbox], [role=switch]')) {
        const rect = button.getBoundingClientRect();
        if (rect.width && rect.height && (rect.left < box.left - 1 || rect.right > box.right + 1)) errors.push({column, text: button.getAttribute('aria-label') || button.textContent || '', kind: 'control', left:rect.left, right:rect.right});
      }
    }
    return errors;
  });
}

async function expectFullValue(page: Page, control: Locator, value: string) {
  await control.focus();
  await expect(control).toBeFocused();
  await expect(control).toHaveAttribute('aria-describedby', /.+/);
  const id = await control.getAttribute('aria-describedby');
  const tooltip = page.locator(`[role="tooltip"][id=${JSON.stringify(id)}]`);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(value);
}

for (const path of collections) test(`${path} long values fit cells at minimum column widths`, async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const unexpected = await setup(page, baseURL!, 'light');
  await page.goto(baseURL! + path);
  await expect(page.locator('.resource-table tbody tr.ant-table-row')).toHaveCount(1);
  await configure(page, true);
  const errors = await cellViolations(page);
  const rowHeight = (await page.locator('.resource-table tbody tr.ant-table-row').boundingBox())!.height;
  await writeFile(info.outputPath('cell-geometry.json'), JSON.stringify({ errors, rowHeight }, null, 2));
  await page.screenshot({ path: info.outputPath('cells.png'), fullPage: true });
  expect(errors).toEqual([]);
  expect(rowHeight).toBeLessThan(360);
  expect(unexpected).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) for (const width of [390, 1440, 1920]) test(`${theme} Routes cells preserve full values and actions at ${width}`, async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const unexpected = await setup(page, baseURL!, theme);
  await page.goto(baseURL! + 'routes');
  await expect(page.locator('.resource-table tbody tr.ant-table-row')).toHaveCount(1);
  await configure(page, width === 1920);
  expect(await cellViolations(page)).toEqual([]);
  const row = page.locator('.resource-table tbody tr.ant-table-row');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('cells.png'), fullPage: true });
  const target = row.getByRole('link', { name: longId, exact: true });
  await expectFullValue(page, target, longId);
  for (const text of ['ai-proxy-multi', `environment=${longLabel}`]) {
    const tag = row.getByLabel(text, { exact: true });
    await expectFullValue(page, tag, text);
  }
  await row.getByRole('button', { name: 'Copy ID', exact: true }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(longId);
  const more = row.getByRole('button', { name: 'Show all 4 plugins', exact: true });
  await more.scrollIntoViewIfNeeded(); await more.focus(); await more.press('Enter');
  const popover = page.locator('.ant-popover').filter({ hasText: '4 plugins' });
  await expect(popover).toBeVisible();
  for (const name of pluginNames) await expect(popover.getByText(name, { exact: true })).toBeVisible();
  await more.press('Escape');
  await row.getByRole('button', { name: 'Expand row', exact: true }).click();
  await expect(page.getByText('Methods:', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('expanded-cells.png'), fullPage: true });
  expect(unexpected).toEqual([]);
});

for (const path of ['consumers', 'consumer_groups', 'plugin_configs']) test(`${path} truncated descriptions expose the complete value on keyboard focus`, async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const unexpected = await setup(page, baseURL!, 'light');
  await page.goto(baseURL! + path);
  await expect(page.locator('.resource-table tbody tr.ant-table-row')).toHaveCount(1);
  await configure(page, true);
  await expectFullValue(page, page.locator('.resource-table').getByText(value.desc, { exact: true }), value.desc);
  expect(unexpected).toEqual([]);
});

for (const path of [`consumers/detail/${longName}/credentials`, `services/detail/${longId}/graphql_cost_decorations`]) test(`${path.split('/')[0]} child table keeps cell contents and Delete within minimum widths`, async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const unexpected = await setup(page, baseURL!, 'light');
  await page.goto(baseURL! + path);
  await expect(page.locator('.resource-table tbody tr.ant-table-row')).toHaveCount(1);
  await configure(page, true);
  expect(await cellViolations(page)).toEqual([]);
  const remove = page.locator('.resource-table').getByRole('button', { name: 'Delete', exact: true });
  await remove.focus(); await remove.press('Enter');
  const dialog = page.getByRole('dialog', { name: /^Delete / });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(unexpected).toEqual([]);
});
