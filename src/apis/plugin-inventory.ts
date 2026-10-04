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
import { SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { req } from '@/config/req';
import { isRecord } from '@/utils/apisixEditable';
import { PLUGIN_SCOPES, type PluginInstance, pluginInstances, type PluginScope, type PluginSource } from '@/utils/pluginInventory';
import { validateExactResourceSnapshot } from '@/utils/resourceIdentity';

async function readSources(scope: PluginScope, signal: AbortSignal, owner?: string): Promise<PluginSource[]> {
  const path = scope === 'credentials' ? `/consumers/${encodeURIComponent(owner!)}/credentials` : `/${scope}`;
  const sources: PluginSource[] = []; const identities = new Set<string>();
  let expected: number | undefined;
  for (let page = 1; ; page++) {
    let data: unknown;
    try {
      const response = await req.get(path, { params: { page, page_size: 100 }, signal, timeout: 15_000,
        headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] } });
      data = response.data;
    } catch (error) {
      // Existing APISIX Credential list contract: 404 means no credentials for this Consumer.
      if (scope === 'credentials' && page === 1 && (error as { response?: { status?: number } }).response?.status === 404) return [];
      throw error;
    }
    if (!isRecord(data) || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || !Array.isArray(data.list) ||
        (expected !== undefined && expected !== data.total)) throw new Error(`Invalid or changing collection: ${path}`);
    expected = Number(data.total);
    for (const envelope of data.list) {
      if (!isRecord(envelope) || !isRecord(envelope.value)) throw new Error(`Invalid resource in ${path}`);
      const value = envelope.value; const field = scope === 'consumers' ? 'username' : 'id';
      if (!Object.hasOwn(value, field) || !['string', 'number'].includes(typeof value[field]) || !String(value[field]).length ||
          typeof value[field] === 'number' && !Number.isFinite(value[field])) throw new Error(`Missing resource identity in ${path}`);
      let id = String(value[field]);
      if (scope === 'credentials' && id.includes('/credentials/')) {
        const prefix = `${owner}/credentials/`;
        if (!id.startsWith(prefix)) throw new Error(`Credential owner mismatch in ${path}`);
        id = id.slice(prefix.length);
      }
      if (!id || ['.', '..'].includes(id)) throw new Error(`Invalid resource identity in ${path}`);
      const api = `${path}/${encodeURIComponent(id)}`;
      validateExactResourceSnapshot(api, value, envelope.key);
      if (identities.has(api)) throw new Error(`Duplicate resource in ${path}; refresh inventory`);
      identities.add(api);
      const source: PluginSource = { api, scope, id, name: typeof value.name === 'string' ? value.name : scope === 'credentials' ? `${owner} / ${id}` : id, value };
      pluginInstances([source]); // Reject malformed plugin maps instead of reporting a complete empty inventory.
      sources.push(source);
    }
    if (sources.length > expected) throw new Error(`Inconsistent total in ${path}`);
    if (sources.length === expected) return sources;
    if (data.list.length !== 100) throw new Error(`Incomplete collection: ${path}`);
  }
}
export type PluginInventory = { rows: PluginInstance[]; sources: number; errors: string[]; readAt: string };
export async function readPluginInventory(signal: AbortSignal): Promise<PluginInventory> {
  const sources: PluginSource[] = []; const errors: string[] = [];
  const scopes = (Object.keys(PLUGIN_SCOPES) as PluginScope[]).filter((scope) => scope !== 'credentials');
  const results = await Promise.allSettled(scopes.map((scope) => readSources(scope, signal)));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') sources.push(...result.value);
    else errors.push(`${PLUGIN_SCOPES[scopes[index]]}: ${result.reason instanceof Error ? result.reason.message : 'Read failed'}`);
  });
  const consumers = sources.filter((source) => source.scope === 'consumers');
  if (results[scopes.indexOf('consumers')].status === 'rejected') errors.push('Credentials could not be enumerated because Consumers are unavailable.');
  for (let start = 0; start < consumers.length; start += 4) {
    if (signal.aborted) throw new Error('Inventory read cancelled');
    const batch = await Promise.allSettled(consumers.slice(start, start + 4).map((consumer) => readSources('credentials', signal, consumer.id)));
    batch.forEach((result, index) => {
      if (result.status === 'fulfilled') sources.push(...result.value);
      else errors.push(`Credentials for ${consumers[start + index].id}: ${result.reason instanceof Error ? result.reason.message : 'Read failed'}`);
    });
  }
  if (signal.aborted) throw new Error('Inventory read cancelled');
  return { rows: pluginInstances(sources), sources: sources.length, errors, readAt: new Date().toLocaleTimeString() };
}
