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

import { compareRouteOverlap, routeOverlapReport, type SavedRoute } from '@/utils/routeOverlap';

const selected: SavedRoute = { id: 'selected', name: 'Selected route', uri: '/api/users', host: 'api.example.com', methods: ['GET'], priority: 0 };
const routes: SavedRoute[] = [selected,
  { ...selected, id: 'higher', name: 'Higher priority', priority: 10 },
  { ...selected, id: 'duplicate', name: 'Duplicate' },
  { id: 'wildcard', name: 'Shared prefix', uri: '/api/*', host: '*.example.com', priority: 99 },
  { ...selected, id: 'conditional', name: 'Header condition', vars: [['http_x_team', '==', 'blue']] },
  { ...selected, id: 'post', name: 'Other method', methods: ['POST'] },
  { ...selected, id: 'disabled', name: 'Disabled', status: 0 },
];
async function setup(page: Page) {
  const writes: string[] = [];
  const state: { fail?: boolean; duplicate?: boolean; changedTotal?: boolean; values: SavedRoute[] } = { values: [...routes] };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace('/apisix/admin', '');
    if (request.method() !== 'GET') { writes.push(path); return route.fulfill({ status: 500, json: {} }); }
    if (path === '/routes') {
      if (state.fail) return route.fulfill({ status: 503, json: { error_msg: 'Fixture unavailable' } });
      const pageNumber = Number(url.searchParams.get('page') || 1); const size = Number(url.searchParams.get('page_size') || 100);
      const values = state.duplicate ? [routes[0], routes[0]] : state.values;
      return route.fulfill({ json: { total: values.length + (state.changedTotal && pageNumber > 1 ? 1 : 0), list: values.slice((pageNumber - 1) * size, pageNumber * size).map((value) => ({ value })) } });
    }
    if (path.startsWith('/routes/')) return route.fulfill({ json: { value: state.values.find((value) => String(value.id) === path.split('/').at(-1)) } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('routes');
  await page.getByRole('button', { name: 'Check route overlaps', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Route overlap candidates' });
  await expect(dialog.getByRole('status')).toContainText('4 candidate(s)');
  return { dialog, state, writes };
}

test('compares all saved match dimensions without guessing runtime winners', () => {
  expect(compareRouteOverlap(selected, routes[1])).toMatchObject({ status: 'Shadow candidate', reasons: expect.arrayContaining(['Route higher has higher priority (10 > 0).']) });
  expect(compareRouteOverlap(selected, routes[2])?.status).toBe('Equal-priority duplicate');
  expect(compareRouteOverlap(selected, routes[3])?.status).toBe('Overlap candidate');
  expect(compareRouteOverlap(selected, routes[4])?.status).toBe('Needs runtime check');
  expect(compareRouteOverlap(selected, routes[5])).toBeUndefined();
  expect(compareRouteOverlap(selected, routes[6])).toBeUndefined();
  expect(compareRouteOverlap(selected, { ...selected, id: 'other', host: 'other.example.com' })).toBeUndefined();
  expect(compareRouteOverlap(selected, { ...selected, id: 'other', uri: '/api/user' })).toBeUndefined();
  expect(routeOverlapReport(selected, routes)).toMatchObject({ disabled: 1, compared: 5 });
});

test('prefix, wildcard host and array matching preserve boundaries and priority limits', () => {
  const route: SavedRoute = { id: 'one', uris: ['/foo*', '/bar'], hosts: ['*.example.com'], methods: ['GET', 'POST'] };
  expect(compareRouteOverlap(route, { id: 'two', uri: '/foobar', host: 'nested.api.example.com', methods: ['POST'] })?.status).toBe('Overlap candidate');
  expect(compareRouteOverlap(route, { id: 'two', uri: '/foo', host: 'example.com' })).toBeUndefined();
  expect(compareRouteOverlap(route, { id: 'two', uri: '/foo', host: 'notexample.com' })).toBeUndefined();
  expect(compareRouteOverlap({ id: 'one', uri: '/foo/*' }, { id: 'two', uri: '/foo' })).toBeUndefined();
  expect(compareRouteOverlap({ id: 'one', uris: ['/b', '/a'], methods: ['GET', 'POST'] }, { id: 'two', uris: ['/a', '/b'], methods: ['POST', 'GET'], priority: 5 })?.status).toBe('Shadow candidate');
});

test('unsupported patterns and conditions stay uncertain even beside a supported overlapping path', () => {
  for (const uri of ['/a/:id', '/a%2Fb', '/a//b', '/a/../b', '/a*b']) expect(compareRouteOverlap({ id: 'one', uri }, { id: 'two', uri: '/a/b' })?.status).toBe('Needs runtime check');
  const mixed = { id: 'one', uris: ['/fixed', '/a/:id'] };
  expect(compareRouteOverlap(mixed, { ...mixed, id: 'two', priority: 5 })?.status).toBe('Needs runtime check');
  for (const extra of [{ remote_addr: '10.0.0.1' }, { remote_addrs: ['10.0.0.0/8'] }, { filter_func: 'function() return true end' }, { priority: '5' }, { methods: [] }, { host: 'api.*.com' }, { status: 'enabled' }]) expect(compareRouteOverlap({ id: 'one', uri: '/a' }, { id: 'two', uri: '/a', ...extra })?.status).toBe('Needs runtime check');
});

test('overlap UI explains findings and opens source RAW without sending writes', async ({ page }, info) => {
  const { dialog, writes } = await setup(page);
  await expect(dialog.getByText('Shadow candidate', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Equal-priority duplicate', { exact: true })).toBeVisible();
  await expect(dialog.getByText('vars requires request-time evaluation', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('route-overlap.png'), animations: 'disabled' });
  await dialog.getByRole('row').filter({ hasText: 'Higher priority' }).getByRole('button', { name: 'Open RAW', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Route: Higher priority / higher' })).toBeVisible();
  expect(writes).toEqual([]);
});

test('failed, duplicate and changing lists never claim a complete comparison', async ({ page }) => {
  const { dialog, state, writes } = await setup(page);
  state.fail = true;
  await dialog.getByRole('button', { name: 'Refresh route comparison' }).click();
  await expect(dialog.getByText('Route comparison unavailable')).toBeVisible();
  await expect(dialog.getByText('Shadow candidate', { exact: true })).toHaveCount(0);
  state.fail = false; state.duplicate = true;
  await dialog.getByRole('button', { name: 'Refresh route comparison' }).click();
  await expect(dialog.getByText('The Route list changed while reading. Refresh the comparison.')).toBeVisible();
  state.duplicate = false;
  state.values = Array.from({ length: 101 }, (_, index) => ({ id: String(index), uri: `/unique-${index}` }));
  state.changedTotal = true;
  await dialog.getByRole('button', { name: 'Refresh route comparison' }).click();
  await expect(dialog.getByText('The Route list is incomplete or invalid. Refresh the comparison.')).toBeVisible();
  state.changedTotal = false;
  state.values = [selected, ...state.values, { ...selected, id: 'second-page', priority: 20 }];
  await dialog.getByRole('button', { name: 'Refresh route comparison' }).click();
  await expect(dialog.getByRole('status')).toContainText('1 candidate(s) / 102 other enabled Route(s) compared');
  await expect(dialog.getByText('Selected route / second-page', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('narrow comparison retains visible actions and disabled Route explanation', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog } = await setup(page);
  await expect(dialog.getByRole('button', { name: 'Open RAW', exact: true }).first()).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('route-overlap-narrow.png'), animations: 'disabled' });
  await dialog.getByRole('combobox', { name: 'Route to compare' }).fill('Disabled');
  await dialog.getByRole('combobox', { name: 'Route to compare' }).press('Enter');
  await expect(dialog.getByText('Selected Route is disabled', { exact: true })).toBeVisible();
});


test('an empty gateway result is explicit after refresh', async ({ page }) => {
  const { dialog, state, writes } = await setup(page);
  state.values = [];
  await dialog.getByRole('button', { name: 'Refresh route comparison' }).click();
  await expect(dialog.getByText('No saved HTTP Routes to compare')).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Route to compare' })).toHaveCount(0);
  expect(writes).toEqual([]);
});
