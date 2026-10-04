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
import { environmentReferences, verifyEnvironmentReferences } from '@/apis/environment-import';
import { EXPORT_VERSION, type ExportData,getImportRequest, IMPORT_ORDER } from '@/apis/export-import';
import { type ImportPreviewItem, importResourceBody, previewImport, readImportResource } from '@/apis/import-preview';
import { trackResourceWrite, UnverifiedResourceWriteError } from '@/apis/tracked-resource-write';
import { req } from '@/config/req';
import { changeUrl, type StagedChange } from '@/stores/changeSets';
import { isDeepEqual } from '@/utils/apisixEditable';
import { hasHistoryProtectedFields } from '@/utils/historyResource';

export type ChangeSetRow = ImportPreviewItem & {
  draft: StagedChange; dependencies: { field: string; url: string; staged: boolean }[];
  order?: number; result?: 'Verified' | 'Verified readable fields' | 'Uncertain' | 'Blocked' | 'Unchanged';
  detail?: string;
};
const failure = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed.';

export async function previewChangeSet(drafts: StagedChange[]): Promise<ChangeSetRow[]> {
  const resources = Object.fromEntries(IMPORT_ORDER.map((kind) => [kind, drafts.filter((draft) => draft.resourceType === kind).map((draft) => draft.item)])) as ExportData['resources'];
  const items = await previewImport({ version: EXPORT_VERSION, exportedAt: new Date().toISOString(), resources }, IMPORT_ORDER);
  const byUrl = new Map(drafts.map((draft) => [changeUrl(draft), draft]));
  const rows: ChangeSetRow[] = items.map((row) => {
    const draft = byUrl.get(row.url!)!;
    const references = environmentReferences(row.resourceType, draft?.item ?? {});
    const dependencies = references.map((ref) => ({ field: ref.field,
      url: `/${ref.targetKind}/${encodeURIComponent(String(ref.value))}`, staged: false }));
    const result: ChangeSetRow = { ...row, draft, dependencies };
    if (draft?.outcome === 'uncertain') {
      result.status = 'Blocked'; result.result = 'Uncertain'; result.error = 'A previous write may have been applied. Inspect the destination before discarding or restaging this item. It will not be retried.';
    } else if (draft?.outcome === 'verified') {
      result.result = hasHistoryProtectedFields(row.url!, row.after) ? 'Verified readable fields' : 'Verified';
      result.detail = 'Previously verified. This item will not be written again.';
    } else if (draft?.baseline !== undefined && row.status !== 'Blocked' && !isDeepEqual(draft.baseline, row.before)) {
      result.status = 'Blocked'; result.error = 'The destination changed since this draft was staged. Reload the source, resolve changes, and stage again.';
    }
    return result;
  });
  const rowsByUrl = new Map(rows.map((row) => [row.url, row]));
  for (const row of rows) {
    row.dependencies.forEach((dependency) => { dependency.staged = rowsByUrl.has(dependency.url); });
    if (row.status === 'Blocked' || row.draft?.outcome) continue;
    try { await verifyEnvironmentReferences(row, rows); }
    catch (error) { row.status = 'Blocked'; row.error = failure(error); }
  }
  // Topological order also covers plugin references in global rules / consumer groups.
  const pending = new Set(rows); let order = 1;
  while (pending.size) {
    const ready = [...pending].filter((row) => row.dependencies.every((dependency) => !pending.has(rowsByUrl.get(dependency.url)!)));
    if (!ready.length) {
      for (const row of pending) { row.status = 'Blocked'; row.error = 'Cyclic staged dependencies cannot be applied safely.'; }
      break;
    }
    for (const row of ready) {
      row.order = order++; pending.delete(row);
      const blocked = row.dependencies.find((dependency) => rowsByUrl.get(dependency.url)?.status === 'Blocked');
      if (blocked) { row.status = 'Blocked'; row.error = `Required staged dependency is blocked: ${blocked.url}`; }
    }
  }
  return rows.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
}

/** Serial writes stop at the first failure. Only GET verification is retried. */
export async function applyChangeSet(plan: ChangeSetRow[], update: (row: ChangeSetRow, outcome?: StagedChange['outcome']) => void) {
  if (plan.some((row) => row.status === 'Blocked')) throw new Error('Resolve every blocked item before applying this change set.');
  for (const row of plan) {
    if (row.draft.outcome) continue;
    let sent = false;
    try {
      const current = await readImportResource(row.resourceType, row.url!);
      if (!isDeepEqual(current, row.before)) throw new Error('The destination changed after preview. Nothing was written for this item. Preview again.');
      if (row.status === 'Unchanged') { update({ ...row, result: 'Unchanged', detail: 'Fresh read confirmed no changes.' }); continue; }
      await verifyEnvironmentReferences(row);
      const { body, url } = getImportRequest(row.resourceType, row.draft.item);
      await trackResourceWrite({ source: 'changeset', method: 'PUT', api: url, body, beforeWrite: (snapshot) => {
        const latest = snapshot === null ? null : importResourceBody(row.resourceType, url, snapshot);
        if (!isDeepEqual(latest, row.before)) throw new Error('The destination changed before writing. Preview again.');
      } }, async () => {
        sent = true; update({ ...row, result: 'Uncertain', detail: 'Writing and verifying with APISIX…' }, 'uncertain');
        return req.put(url, body);
      });
      const readable = hasHistoryProtectedFields(url, row.before, body);
      update({ ...row, result: readable ? 'Verified readable fields' : 'Verified', detail: readable
        ? 'APISIX accepted the write and readable fields match. Protected values cannot be verified from read-back.'
        : 'Read-back verified. This item will not be written again.' }, 'verified');
    } catch (error) {
      const uncertain = sent || error instanceof UnverifiedResourceWriteError;
      update({ ...row, result: uncertain ? 'Uncertain' : 'Blocked', detail: uncertain
        ? 'A write was sent, but its final state is uncertain. Execution stopped; inspect the destination before restaging. No automatic retry.' : failure(error) }, uncertain ? 'uncertain' : undefined);
      return;
    }
  }
}
