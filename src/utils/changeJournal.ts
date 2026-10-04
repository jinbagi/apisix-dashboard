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
import { atom, getDefaultStore } from 'jotai';

import { getImportRequest, IMPORT_ORDER, type ResourceKey } from '@/apis/export-import';
import { importResourceBody } from '@/apis/import-preview';
import { matchesTrackedPut } from '@/apis/tracked-resource-write';
import { rawChange, type StagedChange } from '@/stores/changeSets';
import { isDeepEqual, isRecord } from '@/utils/apisixEditable';
import { getHistoryTarget } from '@/utils/historyResource';
import { decryptRawDraft, encryptRawDraft } from '@/utils/rawDraftStorage';
import { validateExactResourceSnapshot } from '@/utils/resourceIdentity';

export const CHANGE_JOURNAL_KEY = 'change-set-journal:v1';
export const CHANGE_JOURNAL_CONTEXT = '/dashboard-local-change-journal';
export const journalVaultAtom = atom(false);
let vault: { password: string; encoded: string } | undefined;
const invalid = () => new Error('Invalid change journal. Supported resources, exact identities, unique destinations, states and writable snapshots are required.');
const has = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key);

function snapshot(value: unknown, kind: ResourceKey, url: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalid();
  const identity = rawChange(url, '{}', '{}').item;
  const normalized = importResourceBody(kind, url, { ...value, ...identity });
  if (!isDeepEqual(value, normalized)) throw invalid();
  return structuredClone(value);
}

/** An unlocked archive is external input, not trusted application state. */
export function parseChangeJournal(value: unknown): StagedChange[] {
  if (!isRecord(value) || value.format !== 'apisix-change-journal' || value.version !== 1 ||
    !Array.isArray(value.items) || value.items.length > 500) throw invalid();
  const urls = new Set<string>();
  return value.items.map((entry: unknown) => {
    if (!isRecord(entry) || !has(entry, 'resourceType') || !(IMPORT_ORDER as unknown[]).includes(entry.resourceType) || !isRecord(entry.item)) throw invalid();
    const kind = entry.resourceType as ResourceKey;
    if (!has(entry.item, kind === 'consumers' ? 'username' : 'id')) throw invalid();
    if (kind === 'credentials' && !has(entry.item, 'username')) throw invalid();
    if (kind === 'graphqlCostDecorations' && !has(entry.item, 'service_id')) throw invalid();
    const { url } = getImportRequest(kind, entry.item);
    if (!getHistoryTarget(url)?.detail || urls.has(url)) throw invalid();
    // Local archive identity validation: etcd key segments are decoded, unlike request URLs.
    try { validateExactResourceSnapshot(url, entry.item, `/apisix/${url.slice(1).split('/').map(decodeURIComponent).join('/')}`); } catch { throw invalid(); }
    urls.add(url);
    const draft: StagedChange = { resourceType: kind, item: structuredClone(entry.item) };
    if (has(entry, 'baseline')) draft.baseline = entry.baseline === null ? null : snapshot(entry.baseline, kind, url);
    if (has(entry, 'outcome')) {
      if (typeof entry.outcome !== 'string' || !['uncertain', 'verified'].includes(entry.outcome) || !has(entry, 'baseline')) throw invalid();
      draft.outcome = entry.outcome as StagedChange['outcome'];
    }
    if (has(entry, 'verifiedAfter')) draft.verifiedAfter = snapshot(entry.verifiedAfter, kind, url);
    if (draft.outcome === 'verified' && (!draft.verifiedAfter || !matchesTrackedPut(url, getImportRequest(kind, draft.item).body, draft.baseline ?? null, draft.verifiedAfter))) throw invalid();
    if (draft.verifiedAfter && draft.outcome !== 'verified') throw invalid();
    for (const field of ['detail', 'resumeError'] as const) if (has(entry, field)) {
      if (typeof entry[field] !== 'string' || entry[field].length > 2000) throw invalid();
      draft[field] = entry[field];
    }
    return draft;
  });
}
export function serializeChangeJournal(drafts: StagedChange[]) {
  // JSON round-trip validates the exact bytes restored later and preserves own special keys.
  const value = JSON.parse(JSON.stringify({ format: 'apisix-change-journal', version: 1, items: drafts }));
  parseChangeJournal(value);
  return JSON.stringify(value);
}
async function encode(drafts: StagedChange[], password: string) {
  return encryptRawDraft(CHANGE_JOURNAL_CONTEXT, { original: '{}', value: serializeChangeJournal(drafts) }, password);
}
async function withJournalLock<T>(operation: () => T): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('Encrypted checkpoints require browser Web Locks. No next write was sent. Use a supported HTTPS or localhost browser. You can lock and clear this journal, then stage new changes in memory.');
  return navigator.locks.request(`apisix-dashboard:${CHANGE_JOURNAL_KEY}`, { mode: 'exclusive' }, operation);
}
async function storeArchive(encoded: string, expected: string | null, guard?: () => void) {
  // Web Locks coordinate same-origin tabs; localStorage alone is not atomic CAS.
  await withJournalLock(() => {
    guard?.();
    if (localStorage.getItem(CHANGE_JOURNAL_KEY) !== expected) throw new Error('The encrypted journal changed in another tab. No next write was sent. Lock and reopen the journal to review it.');
    localStorage.setItem(CHANGE_JOURNAL_KEY, encoded);
  });
}
export async function enableChangeJournal(drafts: StagedChange[], password: string, expected: string | null) {
  const encoded = await encode(drafts, password);
  await storeArchive(encoded, expected);
  vault = { password, encoded }; getDefaultStore().set(journalVaultAtom, true);
}
export async function unlockChangeJournal(encoded: string, password: string) {
  const decrypted = await decryptRawDraft(CHANGE_JOURNAL_CONTEXT, encoded, password);
  const drafts = parseChangeJournal(JSON.parse(decrypted.value));
  if (localStorage.getItem(CHANGE_JOURNAL_KEY) !== encoded) throw new Error('The encrypted journal changed. Reopen it before unlocking.');
  vault = { password, encoded }; getDefaultStore().set(journalVaultAtom, true);
  return drafts;
}
export async function checkpointChangeJournal(drafts: StagedChange[]) {
  if (!vault) return;
  const current = vault;
  const encoded = await encode(drafts, current.password);
  const stillUnlocked = () => { if (vault !== current) throw new Error('The journal was locked before its checkpoint finished. No next write was sent.'); };
  await storeArchive(encoded, current.encoded, stillUnlocked);
  stillUnlocked();
  vault = { ...current, encoded };
}
export function lockChangeJournal() { vault = undefined; getDefaultStore().set(journalVaultAtom, false); }
export const hasActiveChangeJournal = () => !!vault;
export async function removeChangeJournal(expected: string | null) {
  await withJournalLock(() => {
    if (localStorage.getItem(CHANGE_JOURNAL_KEY) !== expected) throw new Error('The encrypted journal changed. Reopen it first.');
    localStorage.removeItem(CHANGE_JOURNAL_KEY);
  });
  lockChangeJournal();
}
