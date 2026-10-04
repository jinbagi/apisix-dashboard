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
import type { SavedRoute } from '@/utils/routeOverlap';

export const HTTP_ROUTERS = ['radixtree_host_uri', 'radixtree_uri', 'radixtree_uri_with_parameter'] as const;
export type HttpRouter = typeof HTTP_ROUTERS[number];
export type PreviewRequest = { method: string; host: string; path: string; router: HttpRouter | '' };
export type MatchResult = { route: SavedRoute; status: 'Candidate' | 'Needs runtime check' | 'Excluded' | 'Disabled'; reasons: string[]; parameters: Record<string, string> };
type Predicate = { matched?: boolean; reason: string; parameters?: Record<string, string> };
export function validatePreviewRequest(input: PreviewRequest) {
  const errors: string[] = [];
  if (!(HTTP_ROUTERS as readonly string[]).includes(input.router)) errors.push('Choose the HTTP router configured on the gateway.');
  if (!/^[A-Z]+$/.test(input.method)) errors.push('Enter an uppercase HTTP method.');
  if (!input.host || !/^[a-zA-Z0-9.-]+$/.test(input.host)) errors.push('Enter a hostname without scheme, port or path.');
  if (!input.path.startsWith('/') || /[%?#\s]/.test(input.path) || input.path.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(input.path)) errors.push('Enter an already normalized URI path, without query, fragment, percent escapes or dot segments.');
  return errors;
}
function selectedValues(route: SavedRoute, singular: string, plural: string): string[] | undefined {
  if (route[singular] != null && route[plural] != null) return;
  const value: unknown = route[singular] != null ? [route[singular]] : route[plural];
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.length > 0) ? value as string[] : undefined;
}
function pathMatches(pattern: string, request: PreviewRequest): Predicate {
  if (!pattern.startsWith('/') || /[%?#\s]/.test(pattern) || pattern.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(pattern)) return { reason: `URI ${pattern} needs normalization or unsupported matching.` };
  const parameterMode = request.router === 'radixtree_uri_with_parameter';
  if (parameterMode && /[:*][a-zA-Z_]/.test(pattern)) {
    const parts = pattern.split('/'); const actual = request.path.split('/');
    const captures: Record<string, string> = {};
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (/^:[a-zA-Z_][a-zA-Z0-9_]*$/.test(part)) {
        if (!actual[index]) return { matched: false, reason: `URI ${pattern} requires a nonempty parameter segment.` };
        Object.defineProperty(captures, part.slice(1), { value: actual[index], enumerable: true, configurable: true });
      } else if (/^\*[a-zA-Z_][a-zA-Z0-9_]*$/.test(part) && index === parts.length - 1) {
        if (actual.length < parts.length) return { matched: false, reason: `URI ${pattern} does not match this path.` };
        Object.defineProperty(captures, part.slice(1), { value: actual.slice(index).join('/'), enumerable: true, configurable: true });
        return { matched: true, reason: `URI ${pattern} matches in parameter mode.`, parameters: captures };
      } else if (/[:*]/.test(part)) return { reason: `URI ${pattern} uses an unsupported parameter pattern.` };
      else if (part !== actual[index]) return { matched: false, reason: `URI ${pattern} does not match this path.` };
    }
    return { matched: parts.length === actual.length, reason: `URI ${pattern} ${parts.length === actual.length ? 'matches' : 'does not match'} in parameter mode.`, parameters: captures };
  }
  if (pattern.includes('*') && (!pattern.endsWith('*') || pattern.indexOf('*') !== pattern.length - 1)) return { reason: `URI ${pattern} uses an unsupported wildcard.` };
  const matched = pattern.endsWith('*') ? request.path.startsWith(pattern.slice(0, -1)) : pattern === request.path;
  return { matched, reason: `URI ${pattern} ${matched ? 'matches' : 'does not match'} the normalized path.` };
}
function combine(predicates: Predicate[], fallback: string): Predicate {
  return predicates.find((result) => result.matched === true) ?? predicates.find((result) => result.matched === undefined) ?? { matched: false, reason: fallback };
}
function uriMatches(route: SavedRoute, request: PreviewRequest): Predicate {
  const uris = selectedValues(route, 'uri', 'uris');
  if (!uris) return { reason: 'URI fields are missing or invalid.' };
  return combine(uris.map((uri) => pathMatches(uri, request)), 'No configured URI matches this path.');
}
function hostMatches(route: SavedRoute, host: string): Predicate {
  if (route.host == null && route.hosts == null) return { matched: true, reason: 'No host constraint.' };
  const hosts = selectedValues(route, 'host', 'hosts');
  if (!hosts) return { reason: 'Host fields are invalid.' };
  return combine(hosts.map((pattern): Predicate => {
    const normalized = pattern.toLowerCase();
    if (!/^(\*\.)?[a-z0-9.-]+$/.test(normalized)) return { reason: `Host ${pattern} uses an unsupported pattern.` };
    const matched = normalized.startsWith('*.') ? host.toLowerCase().endsWith(normalized.slice(1)) : host.toLowerCase() === normalized;
    return { matched, reason: `Host ${pattern} ${matched ? 'matches' : 'does not match'}.` };
  }), 'No configured host matches.');
}
export function previewRouteRequest(route: SavedRoute, request: PreviewRequest): MatchResult {
  if (route.status === 0) return { route, status: 'Disabled', reasons: ['Route status is disabled.'], parameters: {} };
  const uri = uriMatches(route, request); const host = hostMatches(route, request.host);
  let method: Predicate = { matched: true, reason: 'No method constraint.' };
  if (route.methods != null) {
    if (!Array.isArray(route.methods) || !route.methods.length || route.methods.some((item) => typeof item !== 'string' || !/^[A-Z]+$/.test(item))) method = { reason: 'Method constraints are invalid.' };
    else method = { matched: route.methods.includes(request.method), reason: route.methods.includes(request.method) ? `Method ${request.method} matches.` : `Method ${request.method} is not allowed by this Route.` };
  }
  const predicates = [uri, host, method];
  const excluded = predicates.filter((predicate) => predicate.matched === false);
  if (excluded.length) return { route, status: 'Excluded', reasons: excluded.map((predicate) => predicate.reason), parameters: {} };
  const unknown = predicates.filter((predicate) => predicate.matched === undefined).map((predicate) => predicate.reason);
  for (const field of ['vars', 'remote_addr', 'remote_addrs', 'filter_func']) {
    const value = route[field];
    if (value != null && value !== '' && !(Array.isArray(value) && value.length === 0)) unknown.push(`${field} is not evaluated by this preview.`);
  }
  if (route.status != null && route.status !== 1) unknown.push('Route status is invalid.');
  return { route, status: unknown.length ? 'Needs runtime check' : 'Candidate', reasons: [...predicates.filter((predicate) => predicate.matched).map((predicate) => predicate.reason), ...unknown], parameters: uri.parameters ?? {} };
}
export function previewRequests(routes: SavedRoute[], request: PreviewRequest) {
  const errors = validatePreviewRequest(request); if (errors.length) throw new Error(errors.join(' '));
  return routes.map((route) => previewRouteRequest(route, request));
}
