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

import { stripPatchReadonlyFields } from '@/utils/apisixEditable';

export const historyEntrySchema = z.object({
  id: z.string(), at: z.number().finite(), api: z.string().regex(/^\/[a-z_]+\/[^?#]+$/),
  before: z.record(z.unknown()), after: z.record(z.unknown()),
});
export type ResourceHistoryEntry = z.infer<typeof historyEntrySchema>;
export const resourceHistoryAtom = atom<ResourceHistoryEntry[]>([]);
export const HISTORY_LIMIT = 20;
export const recordResourceChange = (api: string, before: Record<string, unknown>, after: Record<string, unknown>) => {
  const entry = { id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, at: Date.now(), api,
    before: stripPatchReadonlyFields(before), after: stripPatchReadonlyFields(after) };
  const store = getDefaultStore();
  store.set(resourceHistoryAtom, (entries) => [entry, ...entries].slice(0, HISTORY_LIMIT));
};
