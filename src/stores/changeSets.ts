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

import type { ChangeSetRow } from '@/apis/change-sets';
import { getExportResourceKey, getImportRequest, type ResourceKey } from '@/apis/export-import';
import { getChangedTopLevelReadonlyKeys, isRecord } from '@/utils/apisixEditable';
import { getHistoryTarget } from '@/utils/historyResource';

export type StagedChange = {
  resourceType: ResourceKey; item: Record<string, unknown>;
  baseline?: Record<string, unknown> | null;
  outcome?: 'verified' | 'uncertain'; detail?: string;
  verifiedAfter?: Record<string, unknown>; resumeError?: string;
};
export const changeSetAtom = atom<{ drafts: StagedChange[]; plan: ChangeSetRow[] | null; busy: boolean; needsRecheck?: boolean }>({ drafts: [], plan: null, busy: false });
export const changeUrl = (draft: StagedChange) => getImportRequest(draft.resourceType, draft.item).url;

/** Staging is memory only. All destinations are checked before any draft is added. */
export function stageChanges(changes: StagedChange[]) {
  const store = getDefaultStore(); const current = store.get(changeSetAtom);
  if (current.busy) throw new Error('Wait for the current change-set operation to finish.');
  const urls = new Set(current.drafts.map(changeUrl));
  for (const change of changes) {
    const url = changeUrl(change);
    if (!getHistoryTarget(url)?.detail) throw new Error('Only supported resources with explicit IDs can be staged.');
    if (urls.has(url)) throw new Error(`${url} is already staged. Review or remove that draft in Change sets first.`);
    urls.add(url);
  }
  store.set(changeSetAtom, { ...current, drafts: [...current.drafts, ...structuredClone(changes)], plan: null });
}

/** Identity is owned by the resource path, never inferred from editable draft fields. */
export function rawChange(api: string, original: string, value: string): StagedChange {
  if (!getHistoryTarget(api)?.detail) throw new Error('This endpoint cannot be staged.');
  const before: unknown = JSON.parse(original); const after: unknown = JSON.parse(value);
  if (!isRecord(before) || !isRecord(after)) throw new Error('The original and draft must be JSON objects.');
  if (getChangedTopLevelReadonlyKeys(after, before).length) throw new Error('Resource identity and timestamps cannot be changed.');
  const parts = api.slice(1).split('/').map(decodeURIComponent);
  const resourceType = parts[2] === 'credentials' ? 'credentials'
    : parts[2] === 'graphql_cost_decorations' ? 'graphqlCostDecorations'
      : parts[0] === 'secrets' ? 'secrets' : getExportResourceKey(`/${parts[0]}`);
  if (!resourceType) throw new Error('This resource type cannot be staged.');
  const identity = resourceType === 'consumers' ? { username: parts[1] }
    : resourceType === 'credentials' ? { id: parts[3], username: parts[1] }
      : resourceType === 'graphqlCostDecorations' ? { id: parts[3], service_id: parts[1] }
        : resourceType === 'secrets' ? { id: parts[2], manager: parts[1] } : { id: parts[1] };
  const item = { ...after, ...identity };
  if (getImportRequest(resourceType, item).url !== api) throw new Error('The resource path is not canonical.');
  return { resourceType, item, baseline: getImportRequest(resourceType, { ...before, ...identity }).body };
}
