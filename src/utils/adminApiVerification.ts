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
import { getPatchMismatchPaths, isRecord } from '@/utils/apisixEditable';

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });

const stripVerificationPaths = (
  data: Record<string, unknown>,
  paths: string[]
): Record<string, unknown> => {
  if (paths.length === 0) return data;

  const stripPath = (value: unknown, [head, ...rest]: string[]): unknown => {
    if (!head || !isRecord(value)) return value;
    if (!Object.prototype.hasOwnProperty.call(value, head)) return value;

    const copy = { ...value };
    if (rest.length === 0) {
      delete copy[head];
      return copy;
    }

    const nested = stripPath(copy[head], rest);
    if (isRecord(nested) && Object.keys(nested).length === 0) {
      delete copy[head];
    } else {
      copy[head] = nested;
    }
    return copy;
  };

  return paths.reduce(
    (result, path) => stripPath(result, path.split('.')) as Record<string, unknown>,
    data
  );
};

export const verifyAdminApiResource = async (
  api: string,
  expected: Record<string, unknown>,
  options: { ignoredPaths?: string[]; timeoutMs?: number } = {}
) => {
  let lastError: unknown;
  const comparableExpected = stripVerificationPaths(
    expected,
    options.ignoredPaths ?? []
  );

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await req.get(api, {
        timeout: options.timeoutMs,
        headers: {
          [SKIP_INTERCEPTOR_HEADER]: ['404'],
        },
      });
      const actual = response.data?.value as unknown;
      if (!isRecord(actual)) {
        throw new Error('Admin API returned no resource value');
      }

      const mismatches = getPatchMismatchPaths(comparableExpected, actual);
      if (mismatches.length === 0) return actual;

      lastError = new Error(
        `Admin API did not return the saved value for: ${mismatches.join(', ')}`
      );
    } catch (error) {
      lastError = error;
    }

    if (attempt < 2) await wait(250 * (attempt + 1));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Could not verify the resource');
};

export const verifyAdminApiExists = async (api: string) => {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await req.get(api, {
        headers: {
          [SKIP_INTERCEPTOR_HEADER]: ['404'],
        },
      });
      if (isRecord(response.data?.value)) return;
      lastError = new Error('Admin API returned no resource value');
    } catch (error) {
      lastError = error;
    }

    if (attempt < 2) await wait(250 * (attempt + 1));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Could not verify that the resource exists');
};

export const verifyAdminApiField = (
  api: string,
  field: string,
  expected: unknown
) => verifyAdminApiResource(api, { [field]: expected });

export const verifyAdminApiDeletion = async (api: string) => {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await req.get(api, {
        headers: {
          [SKIP_INTERCEPTOR_HEADER]: ['404'],
        },
      });
      lastError = new Error('Resource still exists');
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 404) return;
      lastError = error;
    }

    if (attempt < 2) await wait(250 * (attempt + 1));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Could not verify resource deletion');
};
