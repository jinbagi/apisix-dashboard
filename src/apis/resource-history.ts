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
import type { ResourceHistoryEntry } from '@/stores/resourceHistory';
import { buildPatchPayload, getPatchConflictPaths, isRecord, stripPatchReadonlyFields } from '@/utils/apisixEditable';

export async function prepareHistoryRestore(entry: ResourceHistoryEntry) {
  const response = await req.get(entry.api, { timeout: 15_000 });
  const latest: unknown = response.data?.value;
  if (!isRecord(latest)) throw new Error('The latest resource could not be read. Nothing was restored.');
  const current = stripPatchReadonlyFields(latest);
  const reverse = buildPatchPayload(entry.before, entry.after);
  const conflicts = getPatchConflictPaths(reverse, entry.after, current);
  if (conflicts.length) throw new Error(`Restore blocked: these fields changed again: ${conflicts.join(', ')}.`);
  return { latest, original: JSON.stringify(current, null, 2), value: JSON.stringify(applyBulkPatch(current, reverse), null, 2) };
}
