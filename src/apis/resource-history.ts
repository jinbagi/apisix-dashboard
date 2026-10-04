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
import { applyBulkPatch } from '@/apis/bulk-patch';
import { req } from '@/config/req';
import { historyRestoreReason, type ResourceHistoryEntry } from '@/stores/resourceHistory';
import { buildPatchPayload, getPatchConflictPaths, stripPatchReadonlyFields } from '@/utils/apisixEditable';
import { validateExactResourceSnapshot } from '@/utils/resourceIdentity';

export async function prepareHistoryRestore(entry: ResourceHistoryEntry) {
  const reason = historyRestoreReason(entry);
  if (reason || !entry.before || !entry.after) throw new Error(reason ?? 'This event cannot be restored.');
  const response = await req.get(entry.api, { timeout: 15_000 });
  const latest: unknown = response.data?.value;
  validateExactResourceSnapshot(entry.api, latest, response.data?.key);
  const current = stripPatchReadonlyFields(latest);
  const intendedAfter = entry.restoreAfter ?? entry.after;
  const reverse = buildPatchPayload(entry.before, intendedAfter);
  const conflicts = getPatchConflictPaths(reverse, intendedAfter, current);
  if (conflicts.length) throw new Error(`Restore blocked: these fields changed again: ${conflicts.join(', ')}.`);
  return { latest, original: JSON.stringify(current, null, 2), value: JSON.stringify(applyBulkPatch(current, reverse), null, 2) };
}
