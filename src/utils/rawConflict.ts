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
import { buildPatchPayload, getPatchConflicts, isRecord } from '@/utils/apisixEditable';
import { toJsonPointer } from '@/utils/jsonNavigation';

export type ConflictChoice = 'mine' | 'server';
export type RawConflictSnapshot = {
  previous: Record<string, unknown>;
  draft: Record<string, unknown>;
  latest: Record<string, unknown>;
};
export const valueAtPath = (value: unknown, path: string[]): unknown => {
  let current = value;
  for (const key of path) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
};

// Own properties avoid interpreting resource keys as JavaScript prototype setters.
function assign(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
function applyPatch(before: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const after = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete after[key];
    else {
      const current = Object.hasOwn(before, key) ? before[key] : undefined;
      assign(after, key, isRecord(value) ? applyPatch(isRecord(current) ? current : {}, value) : value);
    }
  }
  return after;
}
function replaceAtPath(target: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const [key, ...rest] = path;
  const result = { ...target };
  if (rest.length) {
    const child = Object.hasOwn(target, key) ? target[key] : undefined;
    assign(result, key, replaceAtPath(isRecord(child) ? child : {}, rest, value));
  } else if (value === undefined) delete result[key];
  else assign(result, key, value);
  return result;
}
export function rawConflicts({ previous, draft, latest }: RawConflictSnapshot) {
  return getPatchConflicts(buildPatchPayload(draft, previous), previous, latest).map((entry) => ({
    ...entry, pointer: toJsonPointer(entry.path), draft: valueAtPath(draft, entry.path),
  }));
}

/** Rebase into an editor draft only; saving always performs another fresh concurrency check. */
export function resolveRawConflicts(snapshot: RawConflictSnapshot, choices: Record<string, ConflictChoice>) {
  const { previous, draft, latest } = snapshot;
  let result = applyPatch(latest, buildPatchPayload(draft, previous));
  for (const entry of rawConflicts(snapshot)) {
    const choice = choices[entry.pointer];
    if (choice !== 'mine' && choice !== 'server') throw new Error(`Choose a value for ${entry.pointer}`);
    result = replaceAtPath(result, entry.path, choice === 'mine' ? entry.draft ?? undefined : entry.latest);
  }
  return result;
}
