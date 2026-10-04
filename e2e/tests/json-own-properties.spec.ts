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
import { expect, test } from '@playwright/test';

import { applyBulkPatch, parseBulkPatch } from '@/apis/bulk-patch';
import { buildPatchPayload, getPatchConflictPaths, getPatchMismatchPaths, mergeEditablePayload,
  mergeEditablePayloadByDirty, sortJsonKeys } from '@/utils/apisixEditable';

const special = () => JSON.parse('{"__proto__":{"polluted":"own data"},"constructor":{"prototype":{"flag":"own data"}},"toString":"own text"}') as Record<string, unknown>;
const checkOwnData = (value: unknown) => {
  expect(value).toEqual(special());
  expect(Object.hasOwn(value as object, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
};

test('sorting and plain form merge preserve special JSON keys without interpreting prototypes', () => {
  checkOwnData(sortJsonKeys(special()));
  checkOwnData(mergeEditablePayload({}, special()));
  expect(JSON.stringify(sortJsonKeys({ plugins: { custom: special() } }))).toContain('"__proto__"');
});

test('dirty form merge reads only own dirty flags and keeps selected JSON data', () => {
  const dirty = JSON.parse('{"__proto__":true,"constructor":true,"toString":true}');
  checkOwnData(mergeEditablePayloadByDirty({}, special(), dirty));
  expect(mergeEditablePayloadByDirty({}, special(), {})).toEqual({});
});

test('PATCH creation handles adding, editing and deleting own special keys', () => {
  checkOwnData(buildPatchPayload(special(), {}));
  expect(buildPatchPayload({}, special())).toEqual(JSON.parse('{"__proto__":null,"constructor":null,"toString":null}'));
  expect(buildPatchPayload({ metadata: special() }, { metadata: {} })).toEqual({ metadata: special() });
  const result = buildPatchPayload(JSON.parse('{"__proto__":{"flag":2}}'), JSON.parse('{"__proto__":{"flag":1}}'));
  expect(result).toEqual(JSON.parse('{"__proto__":{"flag":2}}'));
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
});

test('patch application treats all fields as data while public bulk editor keeps its restrictive validation', () => {
  checkOwnData(applyBulkPatch({}, special()));
  expect(applyBulkPatch({ nested: {} }, { nested: special() })).toEqual({ nested: special() });
  expect(applyBulkPatch(special(), JSON.parse('{"__proto__":null}'))).toEqual({ constructor: { prototype: { flag: 'own data' } }, toString: 'own text' });
  expect(() => parseBulkPatch(JSON.stringify(special()))).toThrow('Unsupported property');
});

test('verification and concurrency checks never accept inherited values as saved resource data', () => {
  expect(getPatchMismatchPaths(JSON.parse('{"__proto__":{}}'), {})).toEqual(['__proto__']);
  expect(getPatchConflictPaths({ constructor: { added: 'mine' } }, {}, { constructor: { server: 'keep' } })).toEqual([]);
});
