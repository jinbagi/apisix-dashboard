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
import { readFileSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';

import { type PreviewRequest, previewRequests, previewRouteRequest, validatePreviewRequest } from '@/utils/requestPreview';
import type { SavedRoute } from '@/utils/routeOverlap';

const golden = JSON.parse(readFileSync('e2e/fixtures/request-preview-319.json', 'utf8')) as Array<{ name: string; route: SavedRoute; request: PreviewRequest; matched: boolean; parameters: Record<string, string> }>;
for (const item of golden) test(`APISIX 3.19 radixtree fixture: ${item.name}`, () => {
  const result = previewRouteRequest(item.route, item.request);
  expect(result.status).toBe(item.matched ? 'Candidate' : 'Excluded');
  expect(result.parameters).toEqual(item.parameters);
});
const request: PreviewRequest = { method: 'GET', host: 'api.example.com', path: '/blog/dog', router: 'radixtree_uri_with_parameter' };

test('unknown conditions stay explicit and definite exclusions remain excluded', () => {
  for (const constraint of [{ vars: [['http_x_a', '==', 'b']] }, { remote_addr: '127.0.0.1' }, { filter_func: 'function() return true end' }, { host: 'api.*.com' }]) {
    expect(previewRouteRequest({ id: 'one', uri: '/blog/:name', ...constraint }, request).status).toBe('Needs runtime check');
    expect(previewRouteRequest({ id: 'one', uri: '/other', ...constraint }, request).status).toBe('Excluded');
  }
  expect(previewRouteRequest({ id: 'one', uri: '/blog/:name', status: 0 }, request).status).toBe('Disabled');
  expect(previewRouteRequest({ id: 'one', uri: '/a%2Fb' }, request).status).toBe('Needs runtime check');
  expect(previewRouteRequest({ id: 'one', uri: '/blog/word-:name' }, request).status).toBe('Needs runtime check');
});

test('preview validates normalization assumptions and safely captures JSON special keys', () => {
  for (const path of ['/a%2Fb', '/a?x=1', '/a#fragment', '/a/../b', '/a//b', 'https://a/b']) expect(validatePreviewRequest({ ...request, path }).length).toBeGreaterThan(0);
  expect(validatePreviewRequest({ ...request, router: '' })).toContain('Choose the HTTP router configured on the gateway.');
  expect(validatePreviewRequest({ ...request, host: 'api.example.com:80' }).length).toBeGreaterThan(0);
  const result = previewRequests([{ id: 'one', uri: '/blog/:__proto__' }], request)[0];
  expect(Object.hasOwn(result.parameters, '__proto__')).toBe(true);
  expect(result.parameters.__proto__).toBe('dog');
  expect(Object.getPrototypeOf(result.parameters)).toBe(Object.prototype);
});

const routes: SavedRoute[] = [
  { id: 'param', name: 'Parameter route', uri: '/blog/:name' },
  { id: 'prefix', name: 'Prefix route', uri: '/blog/*', host: '*.example.com' },
  { id: 'vars', name: 'Header route', uri: '/blog/dog', vars: [['http_x_a', '==', 'b']] },
  { id: 'post', name: 'POST only', uri: '/blog/dog', methods: ['POST'] },
  { id: 'disabled', name: 'Disabled route', uri: '/blog/dog', status: 0 },
];
async function setup(page: Page) {
  const writes: string[] = []; const external: string[] = []; const state = { fail: false, duplicate: false };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname.replace('/apisix/admin', '');
    if (req.method() !== 'GET') { writes.push(path); return route.fulfill({ status: 500, json: {} }); }
    if (path === '/routes') {
      if (state.fail) return route.fulfill({ status: 503, json: { error_msg: 'Fixture unavailable' } });
      const values = state.duplicate ? [routes[0], routes[0]] : routes;
      return route.fulfill({ json: { list: values.map((value) => ({ value })), total: values.length } });
    }
    if (path.startsWith('/routes/')) return route.fulfill({ json: { value: routes.find((value) => value.id === path.split('/').at(-1)) } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.route('https://api.example.com/**', async (route) => { external.push(route.request().url()); await route.abort(); });
  await page.goto('routes');
  await page.getByRole('button', { name: 'Preview request matching', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Request matching preview' });
  await dialog.getByLabel('Host name', { exact: true }).fill('api.example.com');
  await dialog.getByLabel('Normalized URI path', { exact: true }).fill('/blog/dog');
  await dialog.getByRole('combobox', { name: 'Configured HTTP router', exact: true }).click();
  await page.getByText('radixtree_uri_with_parameter', { exact: true }).click();
  return { dialog, writes, external, state };
}

test('preview explains candidates, parameters and exclusions without making traffic requests', async ({ page }, info) => {
  const { dialog, writes, external } = await setup(page);
  await dialog.getByRole('button', { name: 'Preview candidates', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('2 candidate(s) / 1 runtime check(s) / 2 excluded');
  await expect(dialog.getByText('Parameters: {"name":"dog"}', { exact: true })).toBeVisible();
  await expect(dialog.getByText('vars is not evaluated by this preview.', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('request-preview.png'), animations: 'disabled' });
  await dialog.getByRole('checkbox', { name: 'Show excluded and disabled Routes' }).check();
  await expect(dialog.getByText('Method GET is not allowed by this Route.', { exact: true })).toBeVisible();
  await dialog.getByRole('row').filter({ hasText: 'Parameter route / param' }).getByRole('button', { name: 'Open RAW', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Route: Parameter route / param' })).toBeVisible();
  expect(writes).toEqual([]); expect(external).toEqual([]);
});

test('editing inputs clears prior results and rejected reads never become a match result', async ({ page }) => {
  const { dialog, state, writes } = await setup(page);
  await dialog.getByRole('button', { name: 'Preview candidates', exact: true }).click();
  await expect(dialog.getByRole('status')).toBeVisible();
  await dialog.getByLabel('Normalized URI path', { exact: true }).fill('/blog/cat');
  await expect(dialog.getByRole('status')).toHaveCount(0);
  state.fail = true;
  await dialog.getByRole('button', { name: 'Preview candidates', exact: true }).click();
  await expect(dialog.getByText('Preview unavailable', { exact: true })).toBeVisible();
  state.fail = false; state.duplicate = true;
  await dialog.getByRole('button', { name: 'Preview candidates', exact: true }).click();
  await expect(dialog.getByText('The Route list changed while reading. Refresh the comparison.', { exact: true })).toBeVisible();
  state.duplicate = false;
  await dialog.getByRole('button', { name: 'Preview candidates', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('2 candidate(s)');
  expect(writes).toEqual([]);
});

test('narrow request preview keeps labels, results and close action reachable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog, writes } = await setup(page);
  await dialog.getByRole('button', { name: 'Preview candidates', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('2 candidate(s)');
  await dialog.getByRole('button', { name: 'Open RAW', exact: true }).first().scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Open RAW', exact: true }).first()).toBeInViewport();
  const resultButton = await dialog.getByRole('button', { name: 'Open RAW', exact: true }).first().boundingBox();
  const closeButton = await dialog.getByRole('button', { name: 'Close request preview', exact: true }).boundingBox();
  expect(resultButton!.y + resultButton!.height).toBeLessThan(closeButton!.y);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Close request preview', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('request-preview-narrow.png'), animations: 'disabled' });
  expect(writes).toEqual([]);
});
