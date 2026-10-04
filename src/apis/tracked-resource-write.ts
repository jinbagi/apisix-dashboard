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
import type { AxiosRequestConfig, AxiosResponse } from 'axios';

import { applyBulkPatch } from '@/apis/bulk-patch';
import { SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { req } from '@/config/req';
import { type HistorySource, recordResourceChange } from '@/stores/resourceHistory';
import { buildPatchPayload, getPatchMismatchPaths, isRecord, stripSystemReadonlyFields } from '@/utils/apisixEditable';
import { getHistoryIgnoredPaths, getHistoryTarget, hasHistoryProtectedFields } from '@/utils/historyResource';
import { validateExactResourceSnapshot } from '@/utils/resourceIdentity';

export type HistoryOutcome = { status: 'recorded' | 'unchanged' | 'unsupported' | 'unverified'; message: string };
const skips = { [SKIP_INTERCEPTOR_HEADER]: ['network', '400', '401', '403', '404', '409', '422', '500', '502', '503', '504'] };
function comparable(api: string, body: Record<string, unknown>, paths: string[]) {
  const result = structuredClone(stripSystemReadonlyFields(body));
  if (/^\/consumers\/[^/]+\/credentials\//.test(api)) delete result.username;
  if (/^\/services\/[^/]+\/graphql_cost_decorations\//.test(api)) delete result.service_id;
  if (api.startsWith('/ssls/')) { delete result.validity_start; delete result.validity_end; }
  for (const path of paths) {
    const parts = path.split('.');
    let value = result;
    for (const key of parts.slice(0, -1)) {
      if (!isRecord(value[key])) { value = {}; break; }
      value = value[key];
    }
    delete value[parts[parts.length - 1]];
  }
  return result;
}
async function readResource(api: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await req.get(api, { timeout: 15_000, headers: skips });
    const value: unknown = response.data?.value;
    validateExactResourceSnapshot(api, value, response.data?.key);
    return value;
  } catch (error) {
    if ((error as { response?: { status?: number } }).response?.status === 404) return null;
    throw error;
  }
}
export class UnverifiedResourceWriteError extends Error {
  constructor() { super('The write was accepted, but read-back could not verify it. No verified history entry was added. Refresh the resource before retrying.'); }
}
export async function trackResourceWrite<T extends AxiosResponse>(
  options: { source: HistorySource; method: string; api: string; body?: unknown; allowUntracked?: boolean; beforeWrite?: (before: Record<string, unknown> | null) => void | Promise<void> },
  write: () => Promise<T>,
): Promise<{ response: T; history: HistoryOutcome }> {
  const { source, api, body } = options;
  const method = options.method.toUpperCase();
  const target = getHistoryTarget(api);
  const supported = target && (target.detail ? ['PUT', 'PATCH', 'DELETE'].includes(method) : method === 'POST')
    && (method === 'DELETE' || isRecord(body));
  if (!supported) {
    if (!options.allowUntracked) throw new Error('This resource endpoint cannot be verified. No write was sent.');
    return { response: await write(), history: { status: 'unsupported', message: 'No resource history: only supported exact resource writes and generated-ID collection POSTs can be verified. Queries and arbitrary subpaths are not tracked.' } };
  }
  let before: Record<string, unknown> | null = null;
  let beforeReadable = true;
  if (target.detail) {
    try { before = await readResource(api); }
    catch {
      if (!options.allowUntracked) throw new Error('The latest resource could not be read. No write was sent.');
      beforeReadable = false;
    }
  }
  if (options.beforeWrite && !beforeReadable) throw new Error('The latest resource could not be read. No write was sent.');
  await options.beforeWrite?.(before);
  const response = await write();
  if (!beforeReadable) return { response, history: { status: 'unverified', message: 'The write was accepted. Its previous state could not be read, so no verified resource history was recorded. Refresh before retrying.' } };
  let detailApi = api;
  if (!target.detail) {
    const id: unknown = response.data?.value?.id;
    if ((typeof id !== 'string' && typeof id !== 'number') || !String(id)) {
      if (!options.allowUntracked) throw new UnverifiedResourceWriteError();
      return { response, history: { status: 'unverified', message: 'The write was accepted, but no resource ID was returned. No verified history was recorded.' } };
    }
    detailApi = `${api}/${encodeURIComponent(String(id))}`;
  }
  if (!getHistoryTarget(detailApi)?.detail) {
    if (!options.allowUntracked) throw new UnverifiedResourceWriteError();
    return { response, history: { status: 'unverified', message: 'The write was accepted, but its resource path could not be verified. No resource history was recorded.' } };
  }
  const restoreAfter = before && isRecord(body)
    ? method === 'PATCH' ? applyBulkPatch(before, body) : method === 'PUT' ? structuredClone(body) : undefined
    : undefined;
  // GraphQL ownership belongs to the path and is omitted by its PUT wrapper.
  if (restoreAfter && before && /^\/services\/[^/]+\/graphql_cost_decorations\//.test(detailApi) && Object.hasOwn(before, 'service_id'))
    restoreAfter.service_id = before.service_id;
  const paths = getHistoryIgnoredPaths(detailApi);
  const sent = isRecord(body) ? comparable(detailApi, body, paths) : {};
  const expected = method === 'PUT' && before ? buildPatchPayload(sent, comparable(detailApi, before, paths)) : sent;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const after = await readResource(detailApi);
      const verified = method === 'DELETE' ? after === null
        : after !== null && getPatchMismatchPaths(sent, after).length === 0
          && getPatchMismatchPaths(expected, after).length === 0;
      if (verified) {
        const entry = recordResourceChange(detailApi, before, after, { source,
          verification: hasHistoryProtectedFields(detailApi, before, body, after) ? 'readable' : 'full',
          restoreAfter,
        });
        return { response, history: entry
          ? { status: 'recorded', message: 'Read-back verified. Resource history includes the observed before and after values.' }
          : { status: 'unchanged', message: 'Read-back verified, with no observed configuration change. Protected fields may not expose changes; no history entry was added.' } };
      }
    } catch { /* Retry reads only. An accepted write must never be repeated here. */ }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  if (!options.allowUntracked) throw new UnverifiedResourceWriteError();
  return { response, history: { status: 'unverified', message: new UnverifiedResourceWriteError().message } };
}

// Opt-in facade for typed form endpoint wrappers. The shared Axios client and its
// authentication/interceptors are unchanged; RAW and bulk RAW keep their own recorder.
const createHistoryRequest = (source: HistorySource) => new Proxy(req, {
  get(target, property, receiver) {
    if (['put', 'post', 'patch', 'delete'].includes(String(property))) {
      return async (api: string, bodyOrConfig?: unknown, config?: AxiosRequestConfig) => {
        const method = String(property);
        const body = method === 'delete' ? undefined : bodyOrConfig;
        const result = await trackResourceWrite({ source, method, api, body },
          () => target.request({ ...(method === 'delete' ? bodyOrConfig as AxiosRequestConfig : config), url: api, method, data: body }));
        return result.response;
      };
    }
    return Reflect.get(target, property, receiver);
  },
});

export const formHistoryReq = createHistoryRequest('form');
export const bulkHistoryReq = createHistoryRequest('bulk');
