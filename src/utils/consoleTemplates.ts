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

export type ConsoleTemplate = { method: string; resource: string; pathSuffix: string; queryString: string; body: string; endpoint: string };
export type RequestPreset = ConsoleTemplate & { id: string; name: string; collection: string; createdAt: number };
export type ConsoleVariable = { name: string; value: string };
export const MAX_REQUEST_PRESETS = 20;
export const presetCollection = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 64) : '';
export const presetIdentity = (name: string, collection: string) => JSON.stringify([collection.trim().toLowerCase(), name.trim().toLowerCase()]);
export function parseRequestPresets(input: unknown): RequestPreset[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.filter((item): item is RequestPreset => {
    if (!isRecord(item) || !['id', 'name', 'method', 'resource', 'pathSuffix', 'queryString', 'body', 'endpoint'].every((key) => typeof item[key] === 'string') ||
      !item.id || !item.name || !Number.isFinite(item.createdAt) || !['GET', 'PUT', 'POST', 'PATCH', 'DELETE'].includes(String(item.method)) ||
      !/^\/[a-z_]+$/.test(String(item.resource)) || seen.has(String(item.id))) return false;
    seen.add(String(item.id)); return true;
  }).slice(0, MAX_REQUEST_PRESETS).map((item) => ({ ...item, collection: presetCollection(item.collection) }));
}
export function resolveConsoleTemplate(template: ConsoleTemplate, variables: ConsoleVariable[]): ConsoleTemplate {
  const values = new Map<string, string>();
  for (const variable of variables) {
    const name = variable.name.trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('Variable names must start with a letter or underscore and contain only letters, digits and underscores.');
    if (values.has(name)) throw new Error(`Duplicate variable: ${name}`);
    values.set(name, variable.value);
  }
  const substitute = (text: string, context: 'path' | 'query' | 'json' = 'json') => {
    if (/\{\{|\}\}/.test(text.replace(/\{\{[^{}]*\}\}/g, ''))) throw new Error('Close every variable placeholder with double braces, for example {{name}}.');
    return text.replace(/\{\{([^{}]*)\}\}/g, (_, raw: string) => {
      const name = raw.trim();
      if (!values.has(name)) throw new Error(`Define variable: ${name || '(empty name)'}`);
      const value = values.get(name)!;
      if (context === 'path' && ['.', '..'].includes(value)) throw new Error(`Variable ${name} cannot be a dot path segment.`);
      return context === 'json' ? value : encodeURIComponent(value);
    });
  };
  const pathSuffix = substitute(template.pathSuffix, 'path');
  const queryString = substitute(template.queryString, 'query');
  if (/[?#\\]/.test(pathSuffix) || pathSuffix.split('/').some((part) => ['.', '..'].includes(part)))
    throw new Error('Use a relative resource path without query, fragment, backslash or dot segments. Put query parameters in the query field.');
  const replaceJson = (value: unknown): unknown => {
    if (typeof value === 'string') return substitute(value);
    if (Array.isArray(value)) return value.map(replaceJson);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceJson(child)]));
    return value;
  };
  let body = template.body;
  if (!['GET', 'DELETE'].includes(template.method)) {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new Error('Body templates must be valid JSON. Put placeholders inside JSON string values, for example {"uri":"{{uri}}"}.'); }
    body = JSON.stringify(replaceJson(parsed), null, 2);
  }
  const endpoint = `${template.resource}${pathSuffix ? `/${pathSuffix}` : ''}${queryString ? `?${queryString}` : ''}`;
  return { ...template, pathSuffix, queryString, body, endpoint };
}
