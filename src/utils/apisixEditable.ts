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
export const SYSTEM_TIMESTAMP_KEYS = ['create_time', 'update_time'] as const;
export const SYSTEM_READONLY_KEYS = ['id', 'manager', ...SYSTEM_TIMESTAMP_KEYS] as const;
export const PATCH_READONLY_KEYS = [...SYSTEM_READONLY_KEYS, 'username'] as const;

export const stripSystemTimestamps = <T extends Record<string, unknown>>(data: T): T => {
  const copy = { ...data };
  SYSTEM_TIMESTAMP_KEYS.forEach((key) => {
    delete copy[key];
  });
  return copy;
};

export const stripSystemReadonlyFields = <T extends Record<string, unknown>>(data: T): T => {
  const copy = { ...data };
  SYSTEM_READONLY_KEYS.forEach((key) => {
    delete copy[key];
  });
  return copy;
};

export const stripPatchReadonlyFields = <T extends Record<string, unknown>>(data: T): T => {
  const copy = { ...data };
  PATCH_READONLY_KEYS.forEach((key) => {
    delete copy[key];
  });
  return copy;
};

export const restorePatchReadonlyFields = (
  editableData: Record<string, unknown>,
  source: Record<string, unknown>
) => {
  const restored = { ...editableData };
  PATCH_READONLY_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      restored[key] = source[key];
    }
  });
  return restored;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const isDeepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => isDeepEqual(item, right[index]));
  }

  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;

    return leftKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      isDeepEqual(left[key], right[key])
    );
  }

  return false;
};

const KEY_ORDER = [
  // Primary identification
  'id',
  'name',
  'desc',
  'description',

  // Status & priority
  'status',
  'priority',

  // Routing/Matching rules
  'uri',
  'uris',
  'host',
  'hosts',
  'remote_addr',
  'remote_addrs',
  'methods',
  'vars',
  'filter_func',

  // Service / Upstream destination
  'service_id',
  'upstream_id',
  'upstream',

  // Plugins & metadata
  'plugins',
  'plugin_config_id',

  // Security / SSL specific
  'cert',
  'key',
  'snis',

  // General configuration details
  'type',
  'nodes',
  'timeout',
  'checks',
  'labels',
  'metadata',
];

export const sortJsonKeys = (value: unknown, inPluginConfig = false): unknown => {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sortJsonKeys(item, inPluginConfig));
  }

  const obj = value as Record<string, unknown>;

  if (inPluginConfig) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = sortJsonKeys(v, true);
    }
    return result;
  }

  const sorted: Record<string, unknown> = {};

  for (const key of KEY_ORDER) {
    if (key in obj) {
      if (key === 'plugins') {
        const pluginsObj = obj[key];
        if (isRecord(pluginsObj)) {
          const sortedPlugins: Record<string, unknown> = {};
          const pluginNames = Object.keys(pluginsObj).sort();
          for (const name of pluginNames) {
            sortedPlugins[name] = sortJsonKeys(pluginsObj[name], true);
          }
          sorted[key] = sortedPlugins;
        } else {
          sorted[key] = sortJsonKeys(pluginsObj, false);
        }
      } else {
        sorted[key] = sortJsonKeys(obj[key], false);
      }
    }
  }

  const remainingKeys = Object.keys(obj)
    .filter((key) => !KEY_ORDER.includes(key))
    .sort();

  for (const key of remainingKeys) {
    sorted[key] = sortJsonKeys(obj[key], false);
  }

  return sorted;
};

export const mergeEditablePayload = (
  originalValue: unknown,
  formValue: unknown
): unknown => {
  if (!isRecord(originalValue) || !isRecord(formValue)) return formValue;

  const merged: Record<string, unknown> = { ...originalValue };
  for (const [key, value] of Object.entries(formValue)) {
    if (value === undefined) continue;
    const previous = merged[key];
    merged[key] = isRecord(previous) && isRecord(value)
      ? mergeEditablePayload(previous, value)
      : value;
  }
  return merged;
};

export const mergeEditablePayloadByDirty = (
  originalValue: unknown,
  formValue: unknown,
  dirtyFields: unknown
): unknown => {
  if (!isRecord(originalValue) || !isRecord(formValue)) {
    return dirtyFields ? formValue : originalValue;
  }

  const dirtyRecord = isRecord(dirtyFields) ? dirtyFields : {};
  const merged: Record<string, unknown> = { ...originalValue };

  for (const [key, value] of Object.entries(formValue)) {
    if (value === undefined) continue;

    const keyDirty = dirtyRecord[key];
    if (keyDirty === true) {
      merged[key] = value;
      continue;
    }

    if (isRecord(keyDirty) && isRecord(value)) {
      const previous = merged[key];
      const base = isRecord(previous) ? previous : {};
      const nested = mergeEditablePayloadByDirty(base, value, keyDirty);
      if (Object.keys(nested as Record<string, unknown>).length > 0) {
        merged[key] = nested;
      }
    }
  }

  return merged;
};

export const mergeIdentityPayload = (
  originalValue: unknown,
  formValue: unknown
): unknown => {
  if (!isRecord(originalValue) || !isRecord(formValue)) return formValue;

  const merged: Record<string, unknown> = { ...formValue };
  PATCH_READONLY_KEYS.forEach((key) => {
    if (
      merged[key] === undefined &&
      Object.prototype.hasOwnProperty.call(originalValue, key)
    ) {
      merged[key] = originalValue[key];
    }
  });
  return merged;
};

export const buildPatchPayload = (
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
  depth = 0
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);

  for (const key of keys) {
    if (depth === 0 && PATCH_READONLY_KEYS.includes(key as (typeof PATCH_READONLY_KEYS)[number])) {
      continue;
    }

    if (!(key in current)) {
      patch[key] = null;
      continue;
    }

    if (!(key in previous)) {
      patch[key] = current[key];
      continue;
    }

    const currentValue = current[key];
    const previousValue = previous[key];

    if (isRecord(currentValue) && isRecord(previousValue)) {
      const nestedPatch = buildPatchPayload(currentValue, previousValue, depth + 1);
      if (Object.keys(nestedPatch).length > 0) {
        patch[key] = nestedPatch;
      }
      continue;
    }

    if (!isDeepEqual(currentValue, previousValue)) {
      patch[key] = currentValue;
    }
  }

  return patch;
};

export const getChangedTopLevelReadonlyKeys = (
  current: Record<string, unknown>,
  previous: Record<string, unknown>
) =>
  PATCH_READONLY_KEYS.filter((key) => {
    if (!(key in current) && !(key in previous)) return false;
    return !isDeepEqual(current[key], previous[key]);
  });

export const getPatchMismatchPaths = (
  patch: Record<string, unknown>,
  actual: Record<string, unknown>,
  prefix = ''
): string[] => {
  const mismatches: string[] = [];

  for (const [key, expected] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const hasActual = Object.prototype.hasOwnProperty.call(actual, key);
    const actualValue = actual[key];

    if (expected === null) {
      if (hasActual && actualValue !== null) mismatches.push(path);
      continue;
    }

    if (isRecord(expected)) {
      if (!isRecord(actualValue)) {
        mismatches.push(path);
      } else {
        mismatches.push(...getPatchMismatchPaths(expected, actualValue, path));
      }
      continue;
    }

    if (!hasActual || !isDeepEqual(expected, actualValue)) {
      mismatches.push(path);
    }
  }

  return mismatches;
};

/** Detect concurrent edits only where this PATCH will change the latest value. */
export const getPatchConflictPaths = (
  patch: Record<string, unknown>,
  previous: Record<string, unknown>,
  latest: Record<string, unknown>,
  prefix = ''
): string[] => Object.entries(patch).flatMap(([key, expected]) => {
  const before = previous[key];
  const now = latest[key];
  const path = prefix ? `${prefix}.${key}` : key;
  if (isDeepEqual(before, now) || isDeepEqual(expected, now)) return [];
  if (expected === null && now === undefined) return [];
  if (isRecord(expected) && isRecord(now) && (isRecord(before) || before === undefined)) {
    return getPatchConflictPaths(expected, isRecord(before) ? before : {}, now, path);
  }
  return [path];
});
