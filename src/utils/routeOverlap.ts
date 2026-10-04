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
import { isRecord } from '@/utils/apisixEditable';

export type SavedRoute = Record<string, unknown> & { id: string | number };
export type RouteOverlap = { route: SavedRoute; status: 'Overlap candidate' | 'Shadow candidate' | 'Equal-priority duplicate' | 'Needs runtime check'; reasons: string[] };
type Match = { values?: string[]; reason?: string };
function values(route: SavedRoute, single: string, multiple: string, fallback?: string[]): Match {
  const one = route[single]; const many = route[multiple];
  if (one != null && many != null) return { reason: `${single} and ${multiple} are both present` };
  const found: unknown = one != null ? [one] : many ?? fallback;
  if (!Array.isArray(found) || !found.length || found.some((value) => typeof value !== 'string' || !value.length)) return { reason: `Invalid or missing ${single}/${multiple}` };
  return { values: [...new Set(found as string[])].sort() };
}
function uriPattern(value: string) {
  if (!value.startsWith('/') || /[:%?#]/.test(value) || value.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) return;
  if (value.includes('*') && (!value.endsWith('*') || value.indexOf('*') !== value.length - 1)) return;
  return { text: value.endsWith('*') ? value.slice(0, -1) : value, prefix: value.endsWith('*') };
}
function hostPattern(value: string) {
  if (value === '*') return { text: '', suffix: true };
  const normalized = value.toLowerCase();
  if (!/^(\*\.)?[a-z0-9.-]+$/.test(normalized)) return;
  return { text: normalized.startsWith('*.') ? normalized.slice(1) : normalized, suffix: normalized.startsWith('*.') };
}
function uriOverlap(a: string, b: string): boolean | undefined {
  const left = uriPattern(a); const right = uriPattern(b); if (!left || !right) return;
  if (!left.prefix && !right.prefix) return left.text === right.text;
  if (left.prefix && right.prefix) return left.text.startsWith(right.text) || right.text.startsWith(left.text);
  return left.prefix ? right.text.startsWith(left.text) : left.text.startsWith(right.text);
}
function hostOverlap(a: string, b: string): boolean | undefined {
  const left = hostPattern(a); const right = hostPattern(b); if (!left || !right) return;
  if (!left.suffix && !right.suffix) return left.text === right.text;
  if (left.suffix && right.suffix) return left.text.endsWith(right.text) || right.text.endsWith(left.text);
  return left.suffix ? right.text.endsWith(left.text) : left.text.endsWith(right.text);
}
function anyOverlap(a: Match, b: Match, check: (a: string, b: string) => boolean | undefined) {
  if (!a.values || !b.values) return undefined;
  let unknown = false;
  for (const left of a.values) for (const right of b.values) {
    const result = check(left, right); if (result) return true; if (result === undefined) unknown = true;
  }
  return unknown ? undefined : false;
}
function methods(route: SavedRoute): Match {
  if (route.methods == null) return { values: ['*'] };
  if (!Array.isArray(route.methods) || !route.methods.length || route.methods.some((value) => typeof value !== 'string' || !/^[A-Z]+$/.test(value))) return { reason: 'Invalid methods' };
  return { values: [...new Set(route.methods as string[])].sort() };
}
function constraints(route: SavedRoute) {
  const reasons: string[] = [];
  for (const field of ['vars', 'remote_addr', 'remote_addrs', 'filter_func']) {
    const value = route[field];
    if (value != null && !(Array.isArray(value) && value.length === 0) && value !== '') reasons.push(`${field} requires request-time evaluation`);
  }
  if (route.status != null && route.status !== 0 && route.status !== 1) reasons.push('Unknown route status');
  if (route.priority != null && !Number.isSafeInteger(route.priority)) reasons.push('Invalid priority');
  return reasons;
}
const same = (a: Match, b: Match) => Boolean(a.values && b.values && JSON.stringify(a.values) === JSON.stringify(b.values));
export function compareRouteOverlap(selected: SavedRoute, candidate: SavedRoute): RouteOverlap | undefined {
  if (String(selected.id) === String(candidate.id) || selected.status === 0 || candidate.status === 0) return;
  const aUri = values(selected, 'uri', 'uris'); const bUri = values(candidate, 'uri', 'uris');
  const aHost = values(selected, 'host', 'hosts', ['*']); const bHost = values(candidate, 'host', 'hosts', ['*']);
  const aMethod = methods(selected); const bMethod = methods(candidate);
  const uri = anyOverlap(aUri, bUri, uriOverlap); const host = anyOverlap(aHost, bHost, hostOverlap);
  const method = anyOverlap(aMethod, bMethod, (a, b) => a === '*' || b === '*' || a === b);
  if (uri === false || host === false || method === false) return;
  const reasons = [...new Set([...constraints(selected), ...constraints(candidate), ...[aUri, bUri, aHost, bHost, aMethod, bMethod].flatMap((value) => value.reason ? [value.reason] : [])])];
  if (uri === undefined || [...(aUri.values ?? []), ...(bUri.values ?? [])].some((value) => !uriPattern(value))) reasons.push('URI includes unsupported patterns, parameters or normalization-sensitive values');
  if (host === undefined || [...(aHost.values ?? []), ...(bHost.values ?? [])].some((value) => !hostPattern(value))) reasons.push('Host includes an unsupported pattern');
  if (method === undefined) reasons.push('Methods cannot be compared');
  if (reasons.length) return { route: candidate, status: 'Needs runtime check', reasons };
  const sameMatch = same(aUri, bUri) && same(aHost, bHost) && same(aMethod, bMethod);
  const selectedPriority = Number(selected.priority ?? 0); const candidatePriority = Number(candidate.priority ?? 0);
  if (sameMatch && selectedPriority !== candidatePriority) return { route: candidate, status: 'Shadow candidate', reasons: [
    'URI, host and method sets are identical.',
    `${candidatePriority > selectedPriority ? `Route ${candidate.id}` : `Selected route ${selected.id}`} has higher priority (${Math.max(selectedPriority, candidatePriority)} > ${Math.min(selectedPriority, candidatePriority)}).`,
    'The lower-priority route may be shadowed for these saved match conditions.',
  ] };
  if (sameMatch) return { route: candidate, status: 'Equal-priority duplicate', reasons: ['URI, host and method sets are identical.', `Both priorities are ${selectedPriority}; no deterministic winner is claimed.`] };
  return { route: candidate, status: 'Overlap candidate', reasons: ['URI, host and method conditions intersect.', `Priorities: selected ${selectedPriority}, candidate ${candidatePriority}. Different URI/host specificity and router mode affect selection.`] };
}
export function routeOverlapReport(selected: SavedRoute, routes: SavedRoute[]) {
  const candidates = routes.flatMap((route) => { const comparison = compareRouteOverlap(selected, route); return comparison ? [comparison] : []; });
  return { candidates, disabled: routes.filter((route) => route.status === 0).length, compared: routes.filter((route) => route.status !== 0 && String(route.id) !== String(selected.id)).length };
}
export function isSavedRoute(value: unknown): value is SavedRoute {
  return isRecord(value) && Object.hasOwn(value, 'id') && ((typeof value.id === 'string' && value.id.length > 0 && !['.', '..'].includes(value.id)) || (typeof value.id === 'number' && Number.isSafeInteger(value.id)));
}
