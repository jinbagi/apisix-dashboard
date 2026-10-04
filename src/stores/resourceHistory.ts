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
import { z } from 'zod';

import { isDeepEqual, isRecord, stripPatchReadonlyFields } from '@/utils/apisixEditable';
import { getHistoryTarget, hasHistoryProtectedFields } from '@/utils/historyResource';

const historySourceSchema = z.enum(['raw', 'bulk', 'form', 'import', 'console', 'legacy']);
export type HistorySource = z.infer<typeof historySourceSchema>;
// Zod record parsing drops an own __proto__ property; configuration keys are data.
const snapshotSchema = z.custom<Record<string, unknown>>((value) => isRecord(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'History snapshots must be JSON objects')
  .transform((value) => structuredClone(value));
export const historyEntrySchema = z.object({
  id: z.string().min(1), at: z.number().finite(),
  api: z.string().refine((api) => getHistoryTarget(api)?.detail === true, 'Unsupported history resource'),
  before: snapshotSchema.nullable(), after: snapshotSchema.nullable(),
  operation: z.enum(['create', 'update', 'delete']).default('update'),
  source: historySourceSchema.default('legacy'),
  verification: z.enum(['full', 'readable']).default('full'),
  restoreAfter: snapshotSchema.optional(),
}).refine((entry) => entry.operation === 'create'
  ? entry.before === null && entry.after !== null
  : entry.operation === 'delete'
    ? entry.before !== null && entry.after === null
    : entry.before !== null && entry.after !== null, 'History snapshots do not match the operation').transform((entry) =>
  entry.verification === 'readable' || hasHistoryProtectedFields(entry.api, entry.before, entry.after, entry.restoreAfter)
    ? { ...entry, verification: 'readable' as const, restoreAfter: undefined } : entry);
export type ResourceHistoryEntry = z.infer<typeof historyEntrySchema>;
export const resourceHistoryAtom = atom<ResourceHistoryEntry[]>([]);
export const HISTORY_LIMIT = 20;
export const historyRestoreReason = (entry: ResourceHistoryEntry) => entry.operation !== 'update'
  ? 'Create and delete events are view only; field restore supports updates.'
  : entry.verification === 'readable'
    ? 'View only: protected fields cannot be verified or safely restored from read-back values.'
    : undefined;
export const recordResourceChange = (
  api: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null,
  options: { source?: HistorySource; verification?: ResourceHistoryEntry['verification']; restoreAfter?: Record<string, unknown> } = {},
) => {
  const cleanBefore = before === null ? null : stripPatchReadonlyFields(structuredClone(before));
  const cleanAfter = after === null ? null : stripPatchReadonlyFields(structuredClone(after));
  if (isDeepEqual(cleanBefore, cleanAfter)) return;
  const entry = historyEntrySchema.parse({
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, at: Date.now(), api,
    before: cleanBefore, after: cleanAfter,
    operation: before === null ? 'create' : after === null ? 'delete' : 'update',
    source: options.source ?? 'raw', verification: options.verification ?? 'full',
    restoreAfter: options.restoreAfter ? stripPatchReadonlyFields(structuredClone(options.restoreAfter)) : undefined,
  });
  getDefaultStore().set(resourceHistoryAtom, (entries) => [entry, ...entries].slice(0, HISTORY_LIMIT));
  return entry;
};
