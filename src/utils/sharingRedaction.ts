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
import { EXPORT_VERSION, IMPORT_ORDER } from '@/apis/export-import';
import { isRecord } from '@/utils/apisixEditable';
import { assertRestorableExport, SHARING_MARKER } from '@/utils/sharingFormat';

export const SHARING_MAX_BYTES = 10 * 1024 * 1024;
export const REDACTED_VALUE = '[REDACTED]';
export type SharingCandidate = { path: string; reason: string; valueType: string };
export type SharingExport = Record<string, unknown> & { version: number; resources: Record<string, unknown[]> };
const pointerPart = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const secretKeys = new Set(['password', 'passwd', 'secret', 'secret_key', 'client_secret', 'token', 'access_token', 'refresh_token', 'authorization', 'proxy-authorization', 'api_key', 'apikey', 'private_key', 'secret_access_key', 'session_token', 'client_key']);

function walk(value: unknown, visit: (value: unknown, parts: string[], path: string) => boolean | void, parts: string[] = [], depth = 0): void {
  if (depth > 100) throw new Error('This file is nested too deeply to review (maximum 100 levels).');
  const path = parts.length ? `/${parts.map(pointerPart).join('/')}` : '';
  if (visit(value, parts, path) === false) return;
  if (Array.isArray(value)) value.forEach((child, index) => walk(child, visit, [...parts, String(index)], depth + 1));
  else if (isRecord(value)) for (const [key, child] of Object.entries(value)) walk(child, visit, [...parts, key], depth + 1);
}

export function parseSharingExport(text: string): SharingExport {
  if (new TextEncoder().encode(text).byteLength > SHARING_MAX_BYTES) throw new Error('Choose an export file smaller than 10 MiB.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); }
  assertRestorableExport(value);
  if (!isRecord(value) || !Object.hasOwn(value, 'version') || !Number.isInteger(value.version) || Number(value.version) < 1 || Number(value.version) > EXPORT_VERSION || !Object.hasOwn(value, 'resources') || !isRecord(value.resources))
    throw new Error(`Choose an APISIX export file with format version 1–${EXPORT_VERSION} and a resources object.`);
  if (Object.hasOwn(value, 'skippedResources') && (!Array.isArray(value.skippedResources) || value.skippedResources.some((item) => typeof item !== 'string'))) throw new Error('Skipped collections must be a list of names.');
  for (const [kind, items] of Object.entries(value.resources)) {
    if (!(IMPORT_ORDER as string[]).includes(kind) || !Array.isArray(items) || items.some((item) => !isRecord(item)))
      throw new Error('The export contains an unsupported collection or a resource that is not a JSON object.');
  }
  walk(value, () => undefined);
  return value as SharingExport;
}

export function findSharingCandidates(data: SharingExport, customText = ''): SharingCandidate[] {
  const keys = customText.split(/[,\n]/).map((key) => key.trim()).filter(Boolean);
  if (keys.length > 100 || keys.some((key) => key.length > 200)) throw new Error('Use at most 100 custom field names, each at most 200 characters.');
  const custom = new Set(keys.map((key) => key.toLowerCase()));
  const candidates: SharingCandidate[] = [];
  walk(data, (value, parts, path) => {
    if (!parts.length || (parts[0] === 'resources' && parts.length < 4) || (parts.length === 1 && ['version', 'exportedAt'].includes(parts[0]))) return;
    const key = parts.at(-1)!.toLowerCase();
    const kind = parts[0] === 'resources' ? parts[1] : undefined;
    const sslPrivate = kind === 'ssls' && parts.length === 4 && ['key', 'keys'].includes(key);
    const authKey = key === 'key' && ['key-auth', 'jwt-auth', 'hmac-auth'].includes(parts.at(-2) ?? '');
    const secretFile = kind === 'secrets' && key === 'auth_file';
    const reason = custom.has(key) ? 'Custom field name' : secretKeys.has(key) || sslPrivate || authKey || secretFile ? 'Known sensitive field' : undefined;
    if (reason) {
      candidates.push({ path, reason, valueType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value });
      return false;
    }
  });
  return candidates;
}

export function redactSharingExport(data: SharingExport, paths: Iterable<string>): SharingExport {
  const selected = new Set(paths);
  const found = new Set<string>();
  function copy(value: unknown, parts: string[] = []): unknown {
    const path = parts.length ? `/${parts.map(pointerPart).join('/')}` : '';
    if (selected.has(path)) { found.add(path); return REDACTED_VALUE; }
    if (Array.isArray(value)) return value.map((child, index) => copy(child, [...parts, String(index)]));
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child, [...parts, key])]));
    return value;
  }
  const result = copy(data) as SharingExport;
  if (found.size !== selected.size || selected.has('')) throw new Error('A selected field no longer exists. Review the file and select fields again.');
  return { ...result, [SHARING_MARKER]: {
    format: 'apisix-dashboard-sharing-v1', incomplete: true, importable: false,
    redactedPaths: [...found].sort(),
    notice: 'Sharing copy only. Values were intentionally hidden; this is not a backup. Review retained content before sharing.',
  } };
}
