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
import { getImportRequest } from '@/apis/export-import';
import { importResourceBody, readImportResource } from '@/apis/import-preview';
import { matchesTrackedPut } from '@/apis/tracked-resource-write';
import { changeUrl, type StagedChange } from '@/stores/changeSets';
import { isDeepEqual } from '@/utils/apisixEditable';
import { hasHistoryProtectedFields } from '@/utils/historyResource';

/** Read every exact target after reconnect/unlock. Reconciliation never writes resources. */
export async function reconcileChangeJournal(drafts: StagedChange[]): Promise<StagedChange[]> {
  const reconciled: StagedChange[] = [];
  for (const saved of drafts) {
    const draft = structuredClone(saved); delete draft.resumeError;
    const url = changeUrl(draft);
    try {
      const current = await readImportResource(draft.resourceType, url);
      const { body } = getImportRequest(draft.resourceType, draft.item);
      if (draft.outcome === 'verified') {
        if (!draft.verifiedAfter || !isDeepEqual(current, draft.verifiedAfter)) throw new Error('A previously verified destination has changed. Inspect it before removing or restaging this item.');
        draft.detail = 'Previously verified; its current writable configuration still matches. No replay.';
      } else if (draft.outcome === 'uncertain') {
        if (hasHistoryProtectedFields(url, draft.baseline, body, current)) throw new Error('This uncertain write contains protected fields. Read-back cannot establish whether those values were applied. Manual inspection is required; retry remains blocked.');
        if (matchesTrackedPut(url, body, draft.baseline ?? null, current)) {
          draft.outcome = 'verified'; draft.verifiedAfter = current!;
          draft.detail = 'Current destination already matches the intended replacement. No write will be sent; no historical write is inferred.';
        } else if (isDeepEqual(current, draft.baseline)) {
          delete draft.outcome; delete draft.verifiedAfter;
          draft.detail = 'Current destination still matches the recorded baseline. Review and explicitly confirm a retry.';
        } else throw new Error('The uncertain destination matches neither the baseline nor the intended replacement. Resolve it manually before restaging.');
      } else {
        if (draft.baseline !== undefined && !isDeepEqual(current, draft.baseline)) throw new Error('The destination changed since the journal baseline. Resolve it before restaging.');
        draft.baseline = current;
        draft.detail = 'Current destination rechecked. Review its diff before applying.';
      }
    } catch (error) { draft.resumeError = error instanceof Error ? error.message : 'The destination could not be verified. Reconnect and recheck.'; }
    reconciled.push(draft);
  }
  return reconciled;
}

export const verifiedJournalBody = (draft: StagedChange, value: Record<string, unknown>) => importResourceBody(draft.resourceType, changeUrl(draft), value);
