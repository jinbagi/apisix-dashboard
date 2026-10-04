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

import { reconcileChangeJournal } from '@/apis/change-journal';
import { applyChangeSet, previewChangeSet } from '@/apis/change-sets';
import { matchesTrackedPut } from '@/apis/tracked-resource-write';
import { req } from '@/config/req';
import type { StagedChange } from '@/stores/changeSets';
import { adminKeyAtom } from '@/stores/global';
import { resourceHistoryAtom } from '@/stores/resourceHistory';
import { CHANGE_JOURNAL_CONTEXT, CHANGE_JOURNAL_KEY, checkpointChangeJournal, enableChangeJournal, lockChangeJournal, parseChangeJournal, serializeChangeJournal, unlockChangeJournal } from '@/utils/changeJournal';
import { decryptRawDraft, encryptRawDraft } from '@/utils/rawDraftStorage';

const store = getDefaultStore(); const adapter = req.defaults.adapter;
const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let records: Map<string, Record<string, unknown>>;
let writes: string[]; let ignored: boolean; let wrong: boolean; let quota: boolean;
let disk: Map<string, string>;
const draft = (id = 'unit'): StagedChange => ({ resourceType: 'routes', item: { id, uri: '/after' }, baseline: { uri: '/before' } });
const archive = (items: unknown[]) => ({ format: 'apisix-change-journal', version: 1, items });
function response(value: unknown, url = '/routes/unit'): AxiosResponse {
  return { data: { value, key: `/apisix${url}` }, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

test.beforeEach(() => {
  records = new Map([['/routes/unit', { id: 'unit', uri: '/before' }]]); writes = []; ignored = false; wrong = false; quota = false; disk = new Map();
  let held = false;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name: string, options: { ifAvailable: boolean }, operation: (lock: object | null) => unknown) => {
    expect(options.ifAvailable).toBe(true);
    if (held) return operation(null);
    held = true; try { return operation({}); } finally { held = false; }
  } } } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://journal-fixture.example' } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => disk.get(key) ?? null,
    setItem: (key: string, value: string) => { if (quota) throw new Error('Fixture quota exhausted'); disk.set(key, value); },
    removeItem: (key: string) => disk.delete(key),
  } });
  store.set(adminKeyAtom, 'journal-fixture-key'); store.set(resourceHistoryAtom, []);
  req.defaults.adapter = async (config) => {
    const url = config.url!;
    if (config.method === 'put') {
      writes.push(url); if (!ignored) records.set(url, { ...JSON.parse(config.data), id: url.split('/').at(-1), observed_default: 'read-back' });
      return { ...response(records.get(url), url), config };
    }
    if (!records.has(url)) throw new AxiosError('Not found', 'ERR_BAD_REQUEST', config, undefined, { ...response({}), status: 404 });
    return { ...response(wrong ? { ...records.get(url), id: 'other' } : records.get(url), url), config };
  };
});

test.afterEach(() => {
  lockChangeJournal(); req.defaults.adapter = adapter; store.set(adminKeyAtom, ''); store.set(resourceHistoryAtom, []);
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else Reflect.deleteProperty(globalThis, 'navigator');
  if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor); else Reflect.deleteProperty(globalThis, 'location');
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor); else Reflect.deleteProperty(globalThis, 'localStorage');
});

const password = 'fixture journal password';

test('encrypted journal survives real decrypt/parse with own special keys and no plaintext payload', async () => {
  const item = JSON.parse('{"id":"unit","uri":"/after","__proto__":{"secret":"fixture-payload"},"constructor":{"value":1}}');
  const drafts: StagedChange[] = [{ ...draft(), item }];
  await enableChangeJournal(drafts, password, null);
  const encoded = disk.get(CHANGE_JOURNAL_KEY)!;
  expect(encoded).not.toContain('fixture-payload'); expect(encoded).not.toContain(password); expect(encoded).not.toContain('journal-fixture-key');
  lockChangeJournal(); const restored = await unlockChangeJournal(encoded, password);
  expect(restored).toEqual(drafts); expect(Object.hasOwn(restored[0].item, '__proto__')).toBe(true);
  await expect(unlockChangeJournal(encoded, 'incorrect password')).rejects.toThrow('Could not unlock');
});

test('encrypted snapshots preserve slash, tilde, dotted and own special keys through reconcile', async () => {
  const baseline = JSON.parse('{"uri":"/before","a/b":{"~name":{"old":1}},"dotted.key":{"remove/me":true},"__proto__":{"old":true},"constructor":{"keep":1}}');
  const after = JSON.parse('{"uri":"/after","a/b":{"~name":{"next":2}},"__proto__":{"new":true},"constructor":{"keep":1}}');
  const saved: StagedChange = { resourceType: 'routes', item: { ...after, id: 'unit' }, baseline, outcome: 'uncertain' };
  await enableChangeJournal([saved], password, null);
  lockChangeJournal();
  const restored = await unlockChangeJournal(disk.get(CHANGE_JOURNAL_KEY)!, password);
  expect(restored).toEqual([saved]);
  expect(Object.hasOwn(restored[0].baseline!, '__proto__')).toBe(true);
  records.set('/routes/unit', { ...after, id: 'unit' });
  const reconciled = await reconcileChangeJournal(restored);
  expect(reconciled[0].outcome).toBe('verified');
  expect(reconciled[0].verifiedAfter).toEqual(after);
  expect(Object.hasOwn(reconciled[0].verifiedAfter!, '__proto__')).toBe(true);
  expect(matchesTrackedPut('/routes/unit', after, baseline, { ...after, 'dotted.key': { 'remove/me': true } })).toBe(false);
  expect(matchesTrackedPut('/routes/unit', after, baseline, { ...after, 'a/b': { '~name': { next: 2, old: 1 } } })).toBe(false);
  await checkpointChangeJournal(reconciled);
  lockChangeJournal();
  expect(await unlockChangeJournal(disk.get(CHANGE_JOURNAL_KEY)!, password)).toEqual(reconciled);
  expect(writes).toEqual([]);
});

const invalidEntries: [string, unknown[]][] = [
  ['unsupported resource', [{ ...draft(), resourceType: 'settings' }]],
  ['duplicate destination', [draft(), draft()]],
  ['invalid identity', [{ ...draft(), item: { id: '../unsafe', uri: '/' } }]],
  ['wrong child owner', [{ resourceType: 'credentials', item: { id: 'bob/credentials/key', username: 'alice', plugins: {} }, baseline: null }]],
  ['missing GraphQL owner', [{ resourceType: 'graphqlCostDecorations', item: { id: 'cost' }, baseline: null }]],
  ['invalid baseline', [{ ...draft(), baseline: [] }]],
  ['readonly baseline', [{ ...draft(), baseline: { id: 'unit', uri: '/before' } }]],
  ['invalid state', [{ ...draft(), outcome: 'saved-maybe' }]],
  ['array state', [{ ...draft(), outcome: ['uncertain'] }]],
  ['uncertain without baseline', [{ resourceType: 'routes', item: { id: 'unit', uri: '/' }, outcome: 'uncertain' }]],
  ['verified without readback', [{ ...draft(), outcome: 'verified' }]],
  ['verified inconsistent with intent', [{ ...draft(), outcome: 'verified', verifiedAfter: { uri: '/different' } }]],
];
for (const [label, entries] of invalidEntries) test(`rejects restored ${label} before any resource write`, async () => {
  const encoded = await encryptRawDraft(CHANGE_JOURNAL_CONTEXT, { original: '{}', value: JSON.stringify(archive(entries)) }, password);
  disk.set(CHANGE_JOURNAL_KEY, encoded);
  await expect(unlockChangeJournal(encoded, password)).rejects.toThrow(); expect(writes).toEqual([]);
});

test('archive validation accepts native numeric, consumer, Secret and child identities', () => {
  const items: StagedChange[] = [
    { resourceType: 'routes', item: { id: 12, uri: '/' }, baseline: null },
    { resourceType: 'consumers', item: { username: 'alice', plugins: {} }, baseline: null },
    { resourceType: 'secrets', item: { manager: 'vault', id: 'unit', uri: 'https://vault.example', token: 'fixture' }, baseline: null },
    { resourceType: 'credentials', item: { username: 'alice', id: 'alice/credentials/key', plugins: {} }, baseline: null },
    { resourceType: 'graphqlCostDecorations', item: { service_id: 'svc', id: 'cost', max_depth: 5 }, baseline: null },
    { resourceType: 'pluginMetadata', item: { id: 'http-logger', log_format: { path: '$uri' } }, baseline: null },
  ];
  expect(parseChangeJournal(JSON.parse(serializeChangeJournal(items)))).toEqual(items);
});

test('encrypted archive round-trips URL-encoded resource and owner identities', async () => {
  const drafts: StagedChange[] = [
    { resourceType: 'routes', item: { id: 'encoded id?', uri: '/encoded' }, baseline: { uri: '/before' } },
    { resourceType: 'consumers', item: { username: 'team alice', desc: 'After' }, baseline: { username: 'team alice', desc: 'Before' } },
    { resourceType: 'credentials', item: { username: 'team alice', id: 'key ?one', plugins: {} }, baseline: { plugins: {} } },
    { resourceType: 'graphqlCostDecorations', item: { service_id: 'service one', id: 'cost ?one', max_depth: 5 }, baseline: null },
    { resourceType: 'pluginMetadata', item: { id: 'encoded plugin', log_format: { path: '$uri' } }, baseline: null },
  ];
  await enableChangeJournal(drafts, password, null); lockChangeJournal();
  expect(await unlockChangeJournal(disk.get(CHANGE_JOURNAL_KEY)!, password)).toEqual(drafts);
  expect(writes).toEqual([]);
});

test('reconcile never replays completed and already-matching uncertain destinations', async () => {
  records.set('/routes/unit', { id: 'unit', uri: '/after', observed_default: 'read-back' });
  const first = await reconcileChangeJournal([{ ...draft(), outcome: 'uncertain' }]);
  expect(first[0].outcome).toBe('verified'); expect(first[0].verifiedAfter).toEqual({ uri: '/after', observed_default: 'read-back' });
  const again = await reconcileChangeJournal(first); expect(again[0].resumeError).toBeUndefined();
  await applyChangeSet(await previewChangeSet(again), () => {});
  expect(writes).toEqual([]); expect(store.get(resourceHistoryAtom)).toEqual([]);
});

test('reconcile allows explicit retry only when actual baseline still matches', async () => {
  const pending = await reconcileChangeJournal([{ ...draft(), outcome: 'uncertain' }]);
  expect(pending[0].outcome).toBeUndefined(); expect(pending[0].detail).toContain('explicitly confirm'); expect(writes).toEqual([]);
  await applyChangeSet(await previewChangeSet(pending), () => {}); expect(writes).toEqual(['/routes/unit']);
});

test('drift, wrong identity and changed verified snapshots stay blocked without writes', async () => {
  records.set('/routes/unit', { id: 'unit', uri: '/someone-else' });
  let result = await reconcileChangeJournal([{ ...draft(), outcome: 'uncertain' }]); expect(result[0].resumeError).toContain('neither');
  result = await reconcileChangeJournal([{ ...draft(), outcome: 'verified', verifiedAfter: { uri: '/after' } }]); expect(result[0].resumeError).toContain('previously verified');
  wrong = true; result = await reconcileChangeJournal([draft()]); expect(result[0].resumeError).toContain('identity');
  expect((await previewChangeSet(result))[0].status).toBe('Blocked'); expect(writes).toEqual([]);
});

test('protected uncertain writes require manual review even if readable fields match or baseline is unchanged', async () => {
  const ssl: StagedChange = { resourceType: 'ssls', item: { id: 'tls', cert: 'fixture-cert', key: 'fixture-new-private-key' }, baseline: { cert: 'fixture-cert', key: '******' }, outcome: 'uncertain' };
  records.set('/ssls/tls', { id: 'tls', cert: 'fixture-cert', key: '******' });
  const result = await reconcileChangeJournal([ssl]);
  expect(result[0].resumeError).toContain('protected fields'); expect(result[0].outcome).toBe('uncertain');
  expect((await previewChangeSet(result))[0].status).toBe('Blocked'); expect(writes).toEqual([]);
});

test('quota failure before the uncertain checkpoint prevents PUT', async () => {
  const drafts = [draft()]; await enableChangeJournal(drafts, password, null); const prior = disk.get(CHANGE_JOURNAL_KEY);
  const plan = await previewChangeSet(drafts); quota = true;
  await expect(applyChangeSet(plan, async (row, outcome) => { await checkpointChangeJournal([{ ...row.draft, ...(outcome ? { outcome } : {}) }]); })).rejects.toThrow('quota');
  expect(writes).toEqual([]); expect(disk.get(CHANGE_JOURNAL_KEY)).toBe(prior);
});

test('another tab changing the encrypted checkpoint blocks the next resource write', async () => {
  const drafts = [draft()]; await enableChangeJournal(drafts, password, null); const plan = await previewChangeSet(drafts);
  disk.set(CHANGE_JOURNAL_KEY, 'changed by another tab');
  await expect(applyChangeSet(plan, async (row, outcome) => { await checkpointChangeJournal([{ ...row.draft, ...(outcome ? { outcome } : {}) }]); })).rejects.toThrow('another tab');
  expect(writes).toEqual([]);
});

test('accepted write and failed final checkpoint leaves an uncertain archive for safe reconciliation', async () => {
  const drafts = [draft()]; await enableChangeJournal(drafts, password, null); const plan = await previewChangeSet(drafts);
  await expect(applyChangeSet(plan, async (row, outcome) => {
    // Fail only the post-read persistence operation; the pre-write checkpoint is durable.
    quota ||= outcome === 'verified';
    await checkpointChangeJournal([{ ...row.draft, ...(outcome ? { outcome } : {}) }]);
  })).rejects.toThrow();
  expect(writes).toEqual(['/routes/unit']);
  const saved = await decryptRawDraft(CHANGE_JOURNAL_CONTEXT, disk.get(CHANGE_JOURNAL_KEY)!, password);
  const restored = parseChangeJournal(JSON.parse(saved.value)); expect(restored[0].outcome).toBe('uncertain');
  quota = false; const reconciled = await reconcileChangeJournal(restored);
  expect(reconciled[0].outcome).toBe('verified'); expect(writes).toHaveLength(1);
});


test('simultaneous pre-write checkpoints preserve one PUT and safe resumable outcomes', async () => {
  const drafts = [draft()]; await enableChangeJournal(drafts, password, null);
  const plans = await Promise.all([previewChangeSet(drafts), previewChangeSet(drafts)]);
  const outcomes: Array<Array<{ result?: string; detail?: string }>> = [[], []];
  const results = await Promise.allSettled(plans.map((plan, index) => applyChangeSet(plan, async (row, outcome) => {
    outcomes[index].push({ result: row.result, detail: row.detail });
    await checkpointChangeJournal([{ ...row.draft, ...(outcome ? { outcome } : {}) }]);
  })));
  // The executor may report Blocked through its callback and return normally.
  // Rejection depends on whether recording that blocked result also loses the race.
  const terminal = outcomes.map((attempt) => attempt.at(-1)!);
  expect(terminal.filter((outcome) => outcome.result === 'Blocked')).toHaveLength(1);
  expect(terminal.filter((outcome) => ['Verified', 'Uncertain'].includes(outcome.result!))).toHaveLength(1);
  expect(terminal.find((outcome) => outcome.result === 'Blocked')!.detail).toMatch(/checkpoint|journal/);
  for (const result of results.filter((result) => result.status === 'rejected')) expect(String(result.reason)).toMatch(/checkpoint|journal/);
  expect(writes).toEqual(['/routes/unit']);
  expect(store.get(resourceHistoryAtom)).toHaveLength(1);
  const encoded = disk.get(CHANGE_JOURNAL_KEY)!;
  lockChangeJournal();
  const restored = await unlockChangeJournal(encoded, password);
  expect(['uncertain', 'verified']).toContain(restored[0].outcome);
  const reconciled = await reconcileChangeJournal(restored);
  expect(reconciled[0].outcome).toBe('verified');
  expect(reconciled[0].resumeError).toBeUndefined();
  await checkpointChangeJournal(reconciled);
  await applyChangeSet(await previewChangeSet(reconciled), () => {});
  expect(writes).toEqual(['/routes/unit']);
  expect(store.get(resourceHistoryAtom)).toHaveLength(1);
});

test('missing Web Locks blocks persisted execution before any PUT', async () => {
  const drafts = [draft()]; await enableChangeJournal(drafts, password, null);
  const plan = await previewChangeSet(drafts);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  await expect(applyChangeSet(plan, async (row, outcome) => {
    await checkpointChangeJournal([{ ...row.draft, ...(outcome ? { outcome } : {}) }]);
  })).rejects.toThrow('Web Locks');
  expect(writes).toEqual([]);
});
