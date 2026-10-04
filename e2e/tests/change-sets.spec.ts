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
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { getDefaultStore } from 'jotai';

import { applyChangeSet, type ChangeSetRow, previewChangeSet } from '@/apis/change-sets';
import { req } from '@/config/req';
import { changeSetAtom, rawChange, stageChanges, type StagedChange } from '@/stores/changeSets';
import { adminKeyAtom } from '@/stores/global';
import { resourceHistoryAtom } from '@/stores/resourceHistory';

const store = getDefaultStore(); const adapter = req.defaults.adapter;
let records: Map<string, Record<string, unknown>>;
let writes: string[];
let ignored: Set<string>;
let wrongRead: string;
let beforeRead: ((url: string) => void) | undefined;
function response(value: unknown, key?: string): AxiosResponse {
  return { data: { value, key }, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}
const route = (id: string, extra = {}): StagedChange => ({ resourceType: 'routes', item: { id, uri: `/${id}`, ...extra } });

test.beforeEach(() => {
  records = new Map(); writes = []; ignored = new Set(); wrongRead = ''; beforeRead = undefined;
  store.set(adminKeyAtom, 'changeset-fixture'); store.set(resourceHistoryAtom, []); store.set(changeSetAtom, { drafts: [], plan: null, busy: false });
  req.defaults.adapter = async (config) => {
    const url = config.url!;
    if (config.method === 'put') {
      writes.push(url);
      if (!ignored.has(url)) records.set(url, { ...JSON.parse(config.data), id: decodeURIComponent(url.split('/').at(-1)!) });
      return { ...response(records.get(url), `/apisix${url}`), config };
    }
    beforeRead?.(url);
    if (!records.has(url)) throw new AxiosError('Not found', 'ERR_BAD_REQUEST', config, undefined, { ...response({}), status: 404 });
    return { ...response(wrongRead === url ? { ...records.get(url), id: 'wrong' } : structuredClone(records.get(url)), `/apisix${url}`), config };
  };
});

test.afterEach(() => { req.defaults.adapter = adapter; store.set(adminKeyAtom, ''); store.set(resourceHistoryAtom, []); store.set(changeSetAtom, { drafts: [], plan: null, busy: false }); });

async function execute(plan: ChangeSetRow[]) {
  const results = new Map<string, ChangeSetRow>();
  await applyChangeSet(plan, (row, outcome) => { results.set(row.url!, row); if (outcome) row.draft.outcome = outcome; });
  return results;
}

test('staging is atomic, independent of source edits, and rejects duplicate destinations', () => {
  const one = route('one'); stageChanges([one]); one.item.uri = '/changed-after-staging';
  expect(store.get(changeSetAtom).drafts[0].item.uri).toBe('/one');
  expect(() => stageChanges([route('two'), route('one')])).toThrow('already staged');
  expect(store.get(changeSetAtom).drafts).toHaveLength(1); expect(writes).toEqual([]);
});

test('RAW drafts keep exact baseline, custom path identity, and own JSON properties', async () => {
  const before = JSON.parse('{"uri":"/one","__proto__":{"old":true},"constructor":{"keep":1}}');
  records.set('/routes/one', { id: 'one', ...before });
  const draft = rawChange('/routes/one', JSON.stringify(before), JSON.stringify({ ...before, desc: 'After' }));
  expect(Object.hasOwn(draft.item, '__proto__')).toBe(true); expect(draft.item.id).toBe('one');
  const plan = await previewChangeSet([draft]); expect(plan[0].status).toBe('Changed');
  records.set('/routes/one', { id: 'one', ...before, desc: 'Concurrent' });
  expect((await previewChangeSet([draft]))[0].error).toContain('changed since');
  expect(() => rawChange('/routes/one', '{}', '{"id":"other"}')).toThrow('identity');
});

test('create-only baseline rejects an occupied destination before any write', async () => {
  records.set('/routes/one', { id: 'one', uri: '/one' });
  const plan = await previewChangeSet([{ ...route('one'), baseline: null }]);
  expect(plan[0].status).toBe('Blocked'); await expect(execute(plan)).rejects.toThrow('blocked'); expect(writes).toEqual([]);
});

test('references determine order even when fixed import order would place a plugin consumer first', async () => {
  const drafts: StagedChange[] = [route('one', { service_id: 'svc' }),
    { resourceType: 'services', item: { id: 'svc', upstream_id: 'up' } },
    { resourceType: 'globalRules', item: { id: 'global', plugins: { 'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 'up' }] }] } } } },
    { resourceType: 'upstreams', item: { id: 'up', nodes: { '127.0.0.1:1980': 1 } } }];
  const plan = await previewChangeSet(drafts);
  expect(plan.every((row) => row.status === 'New')).toBe(true);
  expect(plan.findIndex((row) => row.url === '/upstreams/up')).toBeLessThan(plan.findIndex((row) => row.url === '/global_rules/global'));
  await execute(plan);
  expect(writes.indexOf('/upstreams/up')).toBeLessThan(writes.indexOf('/services/svc'));
  expect(writes.indexOf('/services/svc')).toBeLessThan(writes.indexOf('/routes/one'));
  expect(store.get(resourceHistoryAtom)).toHaveLength(4);
  expect(store.get(resourceHistoryAtom).every((entry) => entry.source === 'changeset')).toBe(true);
});

test('missing references and incorrect target identities block the complete plan', async () => {
  let plan = await previewChangeSet([route('one', { service_id: 'missing' }), route('two')]);
  expect(plan[0].status).toBe('Blocked'); await expect(execute(plan)).rejects.toThrow('blocked');
  records.set('/routes/one', { id: 'one', uri: '/one' }); wrongRead = '/routes/one';
  plan = await previewChangeSet([route('one')]); expect(plan[0].status).toBe('Blocked'); expect(writes).toEqual([]);
});

test('child owners are staged first and invalid owner reads cannot be used', async () => {
  const drafts: StagedChange[] = [{ resourceType: 'credentials', item: { id: 'key', username: 'alice', plugins: { 'key-auth': { key: 'fixture' } } } }, { resourceType: 'consumers', item: { username: 'alice' } }];
  const plan = await previewChangeSet(drafts);
  expect(plan.map((row) => row.url)).toEqual(['/consumers/alice', '/consumers/alice/credentials/key']);
  expect(plan[1].dependencies[0].url).toBe('/consumers/alice');
});

test('a destination changed after preview stops before PUT and all later writes', async () => {
  const plan = await previewChangeSet([route('one'), route('two')]);
  records.set('/routes/one', { id: 'one', uri: '/concurrent' });
  const results = await execute(plan);
  expect(results.get('/routes/one')?.result).toBe('Blocked'); expect(writes).toEqual([]);
});

test('the final history pre-read is also checked before PUT', async () => {
  const plan = await previewChangeSet([route('one')]); let reads = 0;
  // Fixture simulates a concurrent write at the tracker pre-read.
  // eslint-disable-next-line playwright/no-conditional-in-test
  beforeRead = (url) => { if (url === '/routes/one' && ++reads === 2) records.set(url, { id: 'one', uri: '/concurrent' }); };
  const results = await execute(plan); expect(results.get('/routes/one')?.result).toBe('Blocked'); expect(writes).toEqual([]);
});

test('verified writes are never repeated after a later unverified write or re-preview', async () => {
  const drafts = [route('one'), route('two'), route('three')]; ignored.add('/routes/two');
  const plan = await previewChangeSet(drafts); const results = await execute(plan);
  expect(writes).toEqual(['/routes/one', '/routes/two']);
  expect(results.get('/routes/one')?.result).toBe('Verified'); expect(results.get('/routes/two')?.result).toBe('Uncertain');
  expect(results.has('/routes/three')).toBe(false); expect(store.get(resourceHistoryAtom)).toHaveLength(1);
  const preview = await previewChangeSet(drafts);
  expect(preview.find((row) => row.url === '/routes/one')?.detail).toContain('will not be written again');
  await expect(execute(preview)).rejects.toThrow('blocked'); expect(writes).toHaveLength(2);
});

test('fresh unchanged items produce no write or duplicate history', async () => {
  records.set('/routes/one', { id: 'one', uri: '/one' });
  const results = await execute(await previewChangeSet([route('one')]));
  expect(results.get('/routes/one')?.result).toBe('Unchanged'); expect(writes).toEqual([]); expect(store.get(resourceHistoryAtom)).toEqual([]);
});
