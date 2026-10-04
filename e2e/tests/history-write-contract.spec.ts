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

import { prepareHistoryRestore } from '@/apis/resource-history';
import { trackResourceWrite, UnverifiedResourceWriteError } from '@/apis/tracked-resource-write';
import { req } from '@/config/req';
import { adminKeyAtom } from '@/stores/global';
import { historyRestoreReason, resourceHistoryAtom } from '@/stores/resourceHistory';

test.describe.configure({ mode: 'serial' });
const store = getDefaultStore();
const originalAdapter = req.defaults.adapter;
let reads: string[];
let writes: number;
let current: Record<string, unknown> | null;
let unavailable: boolean;
let afterRead: unknown;
function reply(value: unknown): AxiosResponse {
  return { data: { value }, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

test.beforeEach(() => {
  store.set(adminKeyAtom, 'unit-fixture-key'); store.set(resourceHistoryAtom, []);
  reads = []; writes = 0; current = { id: 'unit', uri: '/before', desc: 'Before', priority: 0 }; unavailable = false; afterRead = undefined;
  req.defaults.adapter = async (config) => {
    reads.push(config.url ?? '');
    if (unavailable) throw new AxiosError('Unavailable', 'ERR_BAD_RESPONSE', config, undefined, { ...reply({}), status: 503 });
    if (current === null) throw new AxiosError('Not found', 'ERR_BAD_REQUEST', config, undefined, { ...reply({}), status: 404 });
    return { ...reply(afterRead === undefined ? current : afterRead), config };
  };
});

test.afterEach(() => { req.defaults.adapter = originalAdapter; store.set(resourceHistoryAtom, []); store.set(adminKeyAtom, ''); });

test('PUT verifies unchanged submitted fields and removed fields, not just its changed patch', async () => {
  const before = current;
  await expect(trackResourceWrite({ source: 'form', method: 'PUT', api: '/routes/unit', body: { uri: '/before', desc: 'After' } }, async () => {
    writes++; current = { id: 'unit', uri: '/concurrent', desc: 'After' }; return reply(current);
  })).rejects.toBeInstanceOf(UnverifiedResourceWriteError);
  expect(writes).toBe(1); expect(reads).toHaveLength(4); expect(store.get(resourceHistoryAtom)).toEqual([]);
  current = before;
  await expect(trackResourceWrite({ source: 'form', method: 'PUT', api: '/routes/unit', body: { uri: '/before', desc: 'After' } }, async () => {
    writes++; current = { id: 'unit', uri: '/before', desc: 'After', priority: 0 }; return reply(current);
  })).rejects.toBeInstanceOf(UnverifiedResourceWriteError);
  expect(writes).toBe(2); expect(store.get(resourceHistoryAtom)).toEqual([]);
});

test('a failed prerequisite read blocks form writes, but Console preserves execution and its actual response', async () => {
  unavailable = true;
  const write = async () => { writes++; return reply({ accepted: true }); };
  const request = { source: 'form' as const, method: 'PATCH', api: '/routes/unit', body: { desc: 'After' } };
  await expect(trackResourceWrite(request, write)).rejects.toThrow('No write was sent');
  expect(writes).toBe(0);
  const outcome = await trackResourceWrite({ ...request, source: 'console', allowUntracked: true }, write);
  expect(outcome.response.data).toEqual({ value: { accepted: true } });
  expect(outcome.history.status).toBe('unverified'); expect(writes).toBe(1); expect(store.get(resourceHistoryAtom)).toEqual([]);
});

test('masked TLS values are observed, labelled readable-only, and cannot be restored', async () => {
  current = { id: 'unit', cert: 'fixture-cert', key: 'server-mask', snis: ['before.example'] };
  const body = { cert: 'fixture-cert', key: 'fixture-private-value', snis: ['after.example'] };
  await trackResourceWrite({ source: 'import', method: 'PUT', api: '/ssls/unit', body }, async () => {
    writes++; current = { id: 'unit', ...body, key: 'server-mask' }; return reply(current);
  });
  const [entry] = store.get(resourceHistoryAtom);
  expect(entry).toMatchObject({ source: 'import', operation: 'update', verification: 'readable', after: { key: 'server-mask' } });
  expect(historyRestoreReason(entry)).toContain('protected fields');
  expect(JSON.stringify(entry)).not.toContain('fixture-private-value');
  expect(JSON.stringify(entry)).not.toContain('unit-fixture-key');
});

test('HTTP failures, malformed read-back, and generated POST without an ID never become verified entries', async () => {
  await expect(trackResourceWrite({ source: 'form', method: 'DELETE', api: '/routes/unit' }, async () => { writes++; throw new Error('Rejected'); })).rejects.toThrow('Rejected');
  expect(store.get(resourceHistoryAtom)).toEqual([]);
  await expect(trackResourceWrite({ source: 'form', method: 'PATCH', api: '/routes/unit', body: { desc: 'After' } }, async () => {
    writes++; afterRead = '<html>fallback</html>'; return reply({ desc: 'After' });
  })).rejects.toBeInstanceOf(UnverifiedResourceWriteError);
  expect(store.get(resourceHistoryAtom)).toEqual([]);
  const outcome = await trackResourceWrite({ source: 'console', method: 'POST', api: '/routes', body: { uri: '/new' }, allowUntracked: true }, async () => { writes++; return reply({ uri: '/new' }); });
  expect(outcome.history.status).toBe('unverified'); expect(writes).toBe(3); expect(store.get(resourceHistoryAtom)).toEqual([]);
});

test('unsupported Console subpaths execute once without before/after guesses', async () => {
  const outcome = await trackResourceWrite({ source: 'console', method: 'PATCH', api: '/routes/unit/plugins', body: {}, allowUntracked: true }, async () => { writes++; return reply({}); });
  expect(outcome.history.status).toBe('unsupported'); expect(reads).toEqual([]); expect(writes).toBe(1); expect(store.get(resourceHistoryAtom)).toEqual([]);
});


test('wrong resource identity blocks writes or rejects read-back without recording another resource', async () => {
  current = { id: 'wrong', desc: 'Before' };
  await expect(trackResourceWrite({ source: 'form', method: 'PATCH', api: '/routes/unit', body: { desc: 'After' } }, async () => { writes++; return reply({}); })).rejects.toThrow('No write was sent');
  expect(writes).toBe(0);
  current = { id: 'unit', desc: 'Before' };
  const outcome = await trackResourceWrite({ source: 'console', method: 'PATCH', api: '/routes/unit', body: { desc: 'After' }, allowUntracked: true }, async () => {
    writes++; current = { id: 'wrong', desc: 'After' }; return reply(current);
  });
  expect(outcome.history.status).toBe('unverified'); expect(writes).toBe(1); expect(store.get(resourceHistoryAtom)).toEqual([]);
});

test('no-op outcomes do not claim an entry and recorded nested snapshots remain immutable', async () => {
  const noChange = await trackResourceWrite({ source: 'console', method: 'PATCH', api: '/routes/unit', body: { desc: 'Before' }, allowUntracked: true }, async () => reply(current));
  expect(noChange.history.status).toBe('unchanged'); expect(store.get(resourceHistoryAtom)).toEqual([]);
  const nested = { label: 'Observed' };
  await trackResourceWrite({ source: 'form', method: 'PATCH', api: '/routes/unit', body: { desc: 'After' } }, async () => {
    current = { id: 'unit', desc: 'After', nested }; return reply(current);
  });
  nested.label = 'Mutated elsewhere';
  expect(store.get(resourceHistoryAtom)[0].after?.nested).toEqual({ label: 'Observed' });
});


test('restore uses write intent while history retains unrelated changes observed during read-back', async () => {
  await trackResourceWrite({ source: 'form', method: 'PATCH', api: '/routes/unit', body: { desc: 'After' } }, async () => {
    current = { id: 'unit', uri: '/concurrent', desc: 'After', priority: 0 }; return reply(current);
  });
  const [entry] = store.get(resourceHistoryAtom);
  expect(entry.after?.uri).toBe('/concurrent');
  expect(entry.restoreAfter?.uri).toBe('/before');
  const draft = await prepareHistoryRestore(entry);
  expect(JSON.parse(draft.value)).toMatchObject({ uri: '/concurrent', desc: 'Before' });
});

test('restore blocks parent removal when read-back observed an unexpected concurrent sibling', async () => {
  await trackResourceWrite({ source: 'console', method: 'PATCH', api: '/routes/unit', body: { labels: { team: 'ours' } } }, async () => {
    current = { ...current, id: 'unit', labels: { team: 'ours', external: 'keep' } }; return reply(current);
  });
  const [entry] = store.get(resourceHistoryAtom);
  expect(entry.after?.labels).toEqual({ team: 'ours', external: 'keep' });
  await expect(prepareHistoryRestore(entry)).rejects.toThrow('Restore blocked: these fields changed again: labels');
});


test('GraphQL restore preserves path-owned service metadata excluded from PUT payloads', async () => {
  current = { id: 'unit', service_id: 'parent', type_name: 'Query', field_name: 'search', cost: 1 };
  await trackResourceWrite({ source: 'form', method: 'PUT', api: '/services/parent/graphql_cost_decorations/unit', body: { type_name: 'Query', field_name: 'search', cost: 2 } }, async () => {
    current = { ...current, id: 'unit', cost: 2 }; return reply(current);
  });
  const [entry] = store.get(resourceHistoryAtom);
  const draft = await prepareHistoryRestore(entry);
  expect(JSON.parse(draft.value)).toMatchObject({ service_id: 'parent', cost: 1 });
});
