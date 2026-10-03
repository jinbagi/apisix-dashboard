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
import { findNodeAtLocation, parseTree } from 'jsonc-parser';

import { isDeepEqual, isRecord } from '@/utils/apisixEditable';

export type JsonPath = Array<string | number>;
export const toJsonPointer = (path: JsonPath) => path.map((part) => `/${String(part).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
export function changedJsonPaths(original: string, modified: string): JsonPath[] {
  try {
    const paths: JsonPath[] = [];
    const walk = (before: unknown, after: unknown, path: JsonPath) => {
      if (isDeepEqual(before, after)) return;
      if (isRecord(before) && isRecord(after)) {
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) walk(before[key], after[key], [...path, key]);
      } else paths.push(path);
    };
    walk(JSON.parse(original), JSON.parse(modified), []);
    return paths;
  } catch { return []; }
}
export function jsonPathOffset(value: string, path: JsonPath) {
  const root = parseTree(value);
  if (!root) return 0;
  const candidate = [...path];
  for (;;) {
    const node = findNodeAtLocation(root, candidate);
    if (node) return node.offset;
    if (!candidate.length) return 0;
    candidate.pop();
  }
}
