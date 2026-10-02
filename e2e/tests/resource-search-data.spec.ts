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
import { expect, test } from '@playwright/test';
import { getDefaultStore } from 'jotai';

import { RESOURCES } from '@/apis/dashboard';
import { createSearchItem, loadSearchCollection, rankSearchItems } from '@/apis/resourceSearch';
import { req } from '@/config/req';
import { adminKeyAtom } from '@/stores/global';

const routes = RESOURCES.find((resource) => resource.key === 'routes')!;

test('ranks exact identities before broad name matches and accepts multiple search words', () => {
  const items = [
    createSearchItem(routes, { id: 'other', name: 'Catalog v2', uri: '/api/catalog', hosts: ['api.test'], labels: { env: 'prod' } })!,
    createSearchItem(routes, { id: 'catalog', name: 'Zebra' })!,
    createSearchItem(routes, { id: 'prefix', name: 'Catalog' })!,
    createSearchItem(routes, { id: 'substring', name: 'Old catalog copy' })!,
  ];
  expect(rankSearchItems(items, ' CATALOG ').map((item) => item.id))
    .toEqual(['catalog', 'prefix', 'other', 'substring']);
  expect(rankSearchItems(items, 'prod api.test').map((item) => item.id)).toEqual(['other']);
  expect(rankSearchItems(items, '/api/catalog')[0].context).toContain('api.test');
});

test('keeps secret managers distinct and encodes consumer identities in navigation', () => {
  const secrets = RESOURCES.find((resource) => resource.key === 'secrets')!;
  const consumers = RESOURCES.find((resource) => resource.key === 'consumers')!;
  const first = createSearchItem(secrets, { id: 'shared', manager: 'vault' })!;
  const second = createSearchItem(secrets, { id: 'shared', manager: 'aws' })!;
  expect(first.key).not.toBe(second.key);
  expect(first.detailPath).toBe('/secrets/detail/vault/shared');
  expect(second.detailPath).toBe('/secrets/detail/aws/shared');
  expect(createSearchItem(consumers, { username: 'client@example.test' })?.detailPath)
    .toBe('/consumers/detail/client%40example.test');
});

test('does not index plugin or provider bodies and ignores resources without identities', () => {
  const item = createSearchItem(routes, {
    id: 'safe', name: 'Safe route', plugins: { 'key-auth': { key: 'private-value' } },
    vault: { token: 'private-token' }, labels: { team: 'catalog' },
  })!;
  expect(rankSearchItems([item], 'private')).toEqual([]);
  expect(rankSearchItems([item], 'catalog')).toEqual([item]);
  expect(createSearchItem(routes, { name: 'No id' })).toBeUndefined();
});

const originalAdapter = req.defaults.adapter;
function mockPageFailure() {
  req.defaults.adapter = async (config) => {
    if (config.params.page === 2) throw new Error('Page unavailable');
    return { config, status: 200, statusText: 'OK', headers: {}, data: { total: 501, list: [{ value: { id: 'available' } }] } };
  };
}

test.afterEach(() => { req.defaults.adapter = originalAdapter; getDefaultStore().set(adminKeyAtom, ''); });

test('loads later pages in order and removes duplicate resource identities', async () => {
  getDefaultStore().set(adminKeyAtom, 'test-admin-key');
  const pages: number[] = [];
  req.defaults.adapter = async (config) => {
    const page = Number(config.params.page);
    pages.push(page);
    const value = { id: ['', 'first', 'later', 'first'][page], name: 'Catalog' };
    return { config, status: 200, statusText: 'OK', headers: {}, data: { total: 1001, list: [{ value }] } };
  };
  const result = await loadSearchCollection(routes, new AbortController().signal);
  expect(pages).toEqual([1, 2, 3]);
  expect(result.incomplete).toBe(false);
  expect(result.items.map((item) => item.id)).toEqual(['first', 'later']);
});

test('marks a missing later page as incomplete while retaining available results', async () => {
  getDefaultStore().set(adminKeyAtom, 'test-admin-key');
  mockPageFailure();
  const result = await loadSearchCollection(routes, new AbortController().signal);
  expect(result.incomplete).toBe(true);
  expect(result.items.map((item) => item.id)).toEqual(['available']);
});

test('rejects cancelled searches before starting further pages', async () => {
  getDefaultStore().set(adminKeyAtom, 'test-admin-key');
  const controller = new AbortController();
  const pages: number[] = [];
  req.defaults.adapter = async (config) => {
    pages.push(config.params.page);
    controller.abort();
    return { config, status: 200, statusText: 'OK', headers: {}, data: { total: 501, list: [] } };
  };
  await expect(loadSearchCollection(routes, controller.signal)).rejects.toThrow();
  expect(pages).toEqual([1]);
});

test('does not report malformed collections as successful empty results', async () => {
  getDefaultStore().set(adminKeyAtom, 'test-admin-key');
  req.defaults.adapter = async (config) => ({ config, status: 200, statusText: 'OK', headers: {}, data: { total: 1, list: 'invalid' } });
  const result = await loadSearchCollection(routes, new AbortController().signal);
  expect(result).toEqual({ items: [], incomplete: true });
});
