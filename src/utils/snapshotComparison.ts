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
import { EXPORT_VERSION, getImportRequest, IMPORT_ORDER, RESOURCE_LABELS, type ResourceKey } from '@/apis/export-import';
import { isDeepEqual, isRecord } from '@/utils/apisixEditable';
import { type CollectionCoverage, type ExportCoverage, readExportCoverage, scopeKey } from '@/utils/exportCoverage';
import { SHARING_MARKER } from '@/utils/sharingFormat';

export type SnapshotStatus = 'Added' | 'Removed' | 'Changed' | 'Unchanged' | 'Not comparable';
export type SnapshotCoverage = 'Complete' | 'Incomplete' | 'Excluded' | 'Unknown' | 'Omitted' | 'Skipped';
type SnapshotCollection = { coverage: SnapshotCoverage; declared?: CollectionCoverage; items: Map<string, Record<string, unknown>> };
export type ConfigurationSnapshot = { name: string; version: number; exportedAt?: string; warnings: string[]; declaredCoverage?: ExportCoverage; collections: Map<ResourceKey, SnapshotCollection> };
export type SnapshotDifference = {
  url: string; resourceType: ResourceKey; status: SnapshotStatus; paths: string[];
  before?: Record<string, unknown>; after?: Record<string, unknown>;
};
const identity = (value: unknown): value is string | number =>
  (typeof value === 'string' && !!value.trim() && !['.', '..'].includes(value)) || (typeof value === 'number' && Number.isFinite(value));

/** Canonicalize only identity metadata; keep all unknown configuration keys. */
function snapshotResource(kind: ResourceKey, input: unknown) {
  if (!isRecord(input)) throw new Error('Resource must be a JSON object');
  const item = { ...input };
  const primary = kind === 'consumers' ? 'username' : 'id';
  if (!Object.hasOwn(item, primary) || !identity(item[primary])) throw new Error(`Missing or invalid ${primary}`);
  if (kind === 'credentials') {
    if (!Object.hasOwn(item, 'username') || !identity(item.username)) throw new Error('Missing or invalid Credential username');
    const credentialId = String(item.id);
    if (credentialId.includes('/credentials/')) {
      const prefix = `${String(item.username)}/credentials/`;
      if (!credentialId.startsWith(prefix) || !identity(credentialId.slice(prefix.length))) throw new Error('Credential owner does not match its composite ID');
      item.id = credentialId.slice(prefix.length);
    }
  }
  if (kind === 'graphqlCostDecorations' && (!Object.hasOwn(item, 'service_id') || !identity(item.service_id))) throw new Error('Missing or invalid GraphQL service_id');
  if (kind === 'secrets') {
    if (!Object.hasOwn(item, 'manager')) {
      const parts = String(item.id).split('/');
      if (parts.length !== 2 || !parts.every(identity)) throw new Error('Secrets require manager and id');
      [item.manager, item.id] = parts;
    } else {
      if (!identity(item.manager)) throw new Error('Missing or invalid Secret manager');
      if (String(item.id).includes('/')) {
        const prefix = `${String(item.manager)}/`;
        if (!String(item.id).startsWith(prefix) || !identity(String(item.id).slice(prefix.length)) || String(item.id).slice(prefix.length).includes('/')) throw new Error('Secret manager does not match its composite ID');
        item.id = String(item.id).slice(prefix.length);
      }
    }
  }
  const url = getImportRequest(kind, item).url;
  const noise = new Set(['id', 'create_time', 'update_time']);
  if (kind === 'credentials') noise.add('username');
  if (kind === 'graphqlCostDecorations') noise.add('service_id');
  if (kind === 'secrets') noise.add('manager');
  const body = Object.fromEntries(Object.entries(item).filter(([key]) => !noise.has(key)));
  return { url, body };
}

export function parseConfigurationSnapshot(text: string, name: string): ConfigurationSnapshot {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024) throw new Error('Choose a snapshot smaller than 10 MiB.');
  const data: unknown = JSON.parse(text);
  const pending: Array<{ value: unknown; depth: number }> = [{ value: data, depth: 0 }];
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (depth > 100) throw new Error('Snapshot nesting exceeds 100 levels.');
    if (value && typeof value === 'object') for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
  }
  if (!isRecord(data) || !Number.isInteger(data.version) || Number(data.version) < 1 || Number(data.version) > EXPORT_VERSION)
    throw new Error(`Snapshot version must be between 1 and ${EXPORT_VERSION}`);
  if (!Object.hasOwn(data, 'resources') || !isRecord(data.resources)) throw new Error('Snapshot resources must be an object');
  if (Object.hasOwn(data, 'exportedAt') && (typeof data.exportedAt !== 'string' || !Number.isFinite(Date.parse(data.exportedAt)))) throw new Error('Invalid exportedAt timestamp');
  if (Object.hasOwn(data, 'skippedResources') && (!Array.isArray(data.skippedResources) || data.skippedResources.some((kind) => typeof kind !== 'string')))
    throw new Error('skippedResources must be an array of resource names');
  const known = new Set<string>(IMPORT_ORDER);
  for (const key of Object.keys(data.resources)) if (!known.has(key)) throw new Error(`Unsupported resource collection: ${key}`);
  const skipped = new Set<string>(data.skippedResources as string[] | undefined);
  const unknownScope = [...skipped].some((kind) => !known.has(kind));
  const declared = Object.hasOwn(data, 'coverage') ? readExportCoverage(data.coverage, IMPORT_ORDER) : undefined;
  const redacted = Object.hasOwn(data, SHARING_MARKER);
  const warnings = !declared ? ['Legacy export coverage is unknown; absent resources cannot establish additions or removals.'] : [];
  if (redacted) warnings.push('This is an incomplete sharing artifact; absence cannot establish additions or removals.');
  const collections = new Map<ResourceKey, SnapshotCollection>();
  for (const kind of IMPORT_ORDER) {
    const present = Object.hasOwn(data.resources, kind);
    const values = present ? data.resources[kind] : [];
    if (!Array.isArray(values)) throw new Error(`${RESOURCE_LABELS[kind]} must be an array`);
    const items = new Map<string, Record<string, unknown>>();
    values.forEach((input, index) => {
      try {
        const resource = snapshotResource(kind, input);
        if (items.has(resource.url)) throw new Error(`Duplicate destination ${resource.url}`);
        items.set(resource.url, resource.body);
      } catch (error) { throw new Error(`${RESOURCE_LABELS[kind]} item ${index + 1}: ${error instanceof Error ? error.message : 'Invalid resource'}`); }
    });
    const coverage = declared?.collections[kind];
    if (coverage) {
      if (coverage.count !== items.size || !present && coverage.state === 'complete') throw new Error(`Coverage count or presence does not match ${kind}`);
      const scope = coverage.scope;
      if (scope.type === 'ids' && [...items.keys()].some((url) => !scope.values.includes(url))) throw new Error(`Resource outside declared ID scope in ${kind}`);
      if (scope.type === 'owners' && [...items.keys()].some((url) => !scope.values.includes(url.split('/').slice(0, 3).join('/')))) throw new Error(`Resource outside declared owner scope in ${kind}`);
      if ((skipped.has(kind) || unknownScope && declared?.mode === 'full') && coverage.state === 'complete') throw new Error(`Skipped collection cannot have complete coverage: ${kind}`);
      const owners = coverage.owners;
      if (owners && [...items.keys()].some((url) => !owners.completed.includes(url.split('/').slice(0, 3).join('/')))) throw new Error(`Unverified owner in ${kind}`);
    }
    collections.set(kind, { coverage: !present ? 'Omitted' : redacted ? 'Incomplete' : coverage ? coverage.state === 'complete' ? 'Complete' : coverage.state === 'excluded' ? 'Excluded' : 'Incomplete' : skipped.has(kind) || unknownScope ? 'Skipped' : 'Unknown', declared: coverage, items });
  }
  return { name, version: Number(data.version), exportedAt: data.exportedAt as string | undefined, warnings, declaredCoverage: declared, collections };
}

const escapePointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
function changedPaths(before: unknown, after: unknown, path = ''): string[] {
  if (isDeepEqual(before, after)) return [];
  if (isRecord(before) && isRecord(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((key) => {
    const pointer = `${path}/${escapePointer(key)}`;
    return !Object.hasOwn(before, key) || !Object.hasOwn(after, key) ? [pointer] : changedPaths(before[key], after[key], pointer);
  });
  // Arrays are ordered configuration values. Report their containing path as one change.
  return [path || '/'];
}

export function compareConfigurationSnapshots(before: ConfigurationSnapshot, after: ConfigurationSnapshot) {
  const items: SnapshotDifference[] = [];
  const coverage = IMPORT_ORDER.map((kind) => {
    const left = before.collections.get(kind)!; const right = after.collections.get(kind)!;
    const comparable = left.coverage === 'Complete' && right.coverage === 'Complete' && left.declared && right.declared && scopeKey(left.declared.scope) === scopeKey(right.declared.scope);
    for (const url of new Set([...left.items.keys(), ...right.items.keys()])) {
      const original = left.items.get(url); const modified = right.items.get(url);
      const status: SnapshotStatus = original && modified ? isDeepEqual(original, modified) ? 'Unchanged' : 'Changed'
        : !original ? comparable ? 'Added' : 'Not comparable'
          : comparable ? 'Removed' : 'Not comparable';
      items.push({ url, resourceType: kind, status, paths: original && modified ? changedPaths(original, modified) : [], before: original, after: modified });
    }
    return { resourceType: kind, before: left.coverage, after: right.coverage, beforeCount: left.items.size, afterCount: right.items.size, beforeScope: left.declared?.scope, afterScope: right.declared?.scope, comparable: !!comparable, beforeOwners: left.declared?.owners, afterOwners: right.declared?.owners };
  });
  items.sort((a, b) => a.url.localeCompare(b.url));
  const counts = Object.fromEntries((['Added', 'Removed', 'Changed', 'Unchanged', 'Not comparable'] as const).map((status) => [status, items.filter((row) => row.status === status).length])) as Record<SnapshotStatus, number>;
  return { items, counts, coverage };
}

/** Stable object order makes the JSON diff semantic; array order and all own keys are preserved. */
export function snapshotJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snapshotJson);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, snapshotJson(value[key])]));
  return value;
}

export function snapshotComparisonReport(before: ConfigurationSnapshot, after: ConfigurationSnapshot) {
  return {
    format: 'apisix-snapshot-comparison', version: 1,
    scope: 'File contents only. Added and Removed describe snapshot differences, not proven changes to a gateway. Only the same complete declared scope on both sides can establish absence. Legacy, excluded, incomplete or different scopes cannot establish absence.',
    before: { name: before.name, version: before.version, exportedAt: before.exportedAt, warnings: before.warnings, coverage: before.declaredCoverage },
    after: { name: after.name, version: after.version, exportedAt: after.exportedAt, warnings: after.warnings, coverage: after.declaredCoverage },
    ...compareConfigurationSnapshots(before, after),
  };
}
