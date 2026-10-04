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

import { getAPISIXConf } from '@e2e/utils/common';
import { test } from '@e2e/utils/test';
import { uiFillMonacoEditor } from '@e2e/utils/ui';
import { expect, type Page } from '@playwright/test';

let expectedAdminKey: string;

const selectMethod = async (page: Page, method: string) => {
  const select = page
    .getByRole('combobox', { name: 'Method' })
    .locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]'
    )
    .first();
  await select.click();
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByText(method, { exact: true })
    .click();
  await expect(select).toContainText(method);
};

test.beforeEach(async ({ page }) => {
  expectedAdminKey = (await getAPISIXConf()).adminKey;
  await page.evaluate(() => sessionStorage.clear());

  let retryRouteAttempts = 0;
  await page.route('**/apisix/admin/routes**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === 'GET' &&
      url.pathname.endsWith('/apisix/admin/routes/retry-console-route')
    ) {
      retryRouteAttempts += 1;
      await route.fulfill({
        status: retryRouteAttempts === 1 ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          retryRouteAttempts === 1
            ? { error_msg: 'temporary upstream unavailable' }
            : { value: { id: 'retry-console-route', uri: '/retry-console' } }
        ),
      });
      return;
    }

    if (
      request.method() === 'GET' &&
      url.pathname.endsWith('/apisix/admin/routes/editable-console-route')
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          value: {
            id: 'editable-console-route',
            uri: '/editable-console',
            name: 'Editable Console Route',
            create_time: 1710000000,
            update_time: 1710000100,
          },
        }),
      });
      return;
    }

    if (
      request.method() === 'PUT' &&
      url.pathname.endsWith('/apisix/admin/routes/raw-console-route')
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'x-api-console-test': 'put-executed',
        },
        body: JSON.stringify({
          value: request.postDataJSON(),
        }),
      });
      return;
    }

    const isConsoleRequest =
      url.searchParams.get('page') === '2'
      && url.searchParams.get('page_size') === '25';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'x-api-console-test': isConsoleRequest ? 'executed' : 'bootstrap',
      },
      body: JSON.stringify({
        list: isConsoleRequest
          ? [{ value: { id: 'route-25', name: 'Route 25', uri: '/test' } }]
          : [],
        total: isConsoleRequest ? 1 : 0,
      }),
    });
  });

  await page.goto('raw_api');
});

test('executes query requests and exposes response diagnostics', async ({ page }) => {
  // Select GET method since default is now PUT
  await selectMethod(page, 'GET');

  const queryInput = page.getByRole('textbox', { name: 'Query parameters' });
  await queryInput.fill('page=2&page_size=25');

  await expect(page.getByText('/apisix/admin/routes?page=2&page_size=25')).toBeVisible();

  const requestPromise = page.waitForRequest((request) =>
    request.url().includes('/apisix/admin/routes?page=2&page_size=25')
  );
  await page.keyboard.press('Control+Enter');
  const request = await requestPromise;

  expect(request.headers()['x-api-key']).toBe(expectedAdminKey);
  await expect(
    page.locator('.ant-tag').filter({ hasText: '200' }).first()
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'History (1)' })).toBeVisible();

  await page.getByText('Headers', { exact: true }).click();
  await expect(page.locator('.view-lines')).toContainText('x-api-console-test');
  await expect(page.locator('.view-lines')).toContainText('executed');
  await expect(page.getByRole('button', { name: 'Copy headers' })).toBeVisible();

  await page.getByRole('button', { name: 'History (1)' }).click();
  await expect(
    page.getByRole('button', {
      name: /GET \/routes\?page=2&page_size=25 200/,
    })
  ).toBeVisible();
});

test('saves and restores session presets without executing them', async ({ page }) => {
  // Select GET method since default is now PUT
  await selectMethod(page, 'GET');

  const queryInput = page.getByRole('textbox', { name: 'Query parameters' });
  await queryInput.fill('page=2&page_size=25');

  await page.getByRole('button', { name: 'Save preset' }).click();
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Paged routes');
  await page
    .getByRole('dialog', { name: 'Save session preset' })
    .getByRole('button', { name: 'Save preset' })
    .click();

  await expect(page.getByRole('button', { name: 'Presets (1)' })).toBeVisible();
  await queryInput.fill('page=9');

  let consoleRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/apisix/admin/routes?page=2&page_size=25')) {
      consoleRequests += 1;
    }
  });

  await page.getByRole('button', { name: 'Presets (1)' }).click();
  await page.getByRole('button', { name: 'Load preset Paged routes', exact: true }).click();
  await page.getByRole('dialog', { name: 'Replace request draft?' }).getByRole('button', { name: 'Discard and replace' }).click();

  await expect(queryInput).toHaveValue('page=2&page_size=25');
  await expect(page.getByText('/apisix/admin/routes?page=2&page_size=25')).toBeVisible();
  expect(consoleRequests).toBe(0);

  const presets = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('api-console:session-presets') ?? '[]')
  );
  expect(presets).toHaveLength(1);
  expect(presets[0]).toMatchObject({
    name: 'Paged routes',
    method: 'GET',
    endpoint: '/routes?page=2&page_size=25',
  });
});

test('restores failed requests for correction and rerun', async ({ page }) => {
  await selectMethod(page, 'GET');

  const pathInput = page.getByRole('combobox', { name: /Path suffix/ });
  await pathInput.fill('retry-console-route');

  const failedResponse = page.waitForResponse((response) =>
    response.url().includes('/apisix/admin/routes/retry-console-route')
  );
  await page.getByRole('button', { name: /Send GET/ }).click();
  expect((await failedResponse).status()).toBe(503);

  await expect(page.getByText('Request failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore request' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

  await pathInput.fill('edited-away');
  await page.getByRole('button', { name: 'Restore request' }).click();
  await page.getByRole('dialog', { name: 'Replace request draft?' }).getByRole('button', { name: 'Discard and replace' }).click();
  await expect(pathInput).toHaveValue('retry-console-route');

  const retriedResponse = page.waitForResponse((response) =>
    response.url().includes('/apisix/admin/routes/retry-console-route')
  );
  await page.getByRole('button', { name: /Send GET/ }).click();
  expect((await retriedResponse).status()).toBe(200);

  await expect(
    page.locator('.ant-tag').filter({ hasText: '200' }).first()
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'History (2)' })).toBeVisible();
});

test('loads existing resources as editable request bodies', async ({ page }) => {
  const pathInput = page.getByRole('combobox', { name: /Path suffix/ });
  await pathInput.fill('editable-console-route');

  const loadedResponse = page.waitForResponse((response) =>
    response.url().includes('/apisix/admin/routes/editable-console-route')
  );
  await page.getByRole('button', { name: 'Load resource' }).click();
  expect((await loadedResponse).status()).toBe(200);

  await expect(
    page.getByText('Loaded as editable request body', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Removed read-only fields: id, create_time, update_time.')
  ).toBeVisible();

  const requestEditor = page.locator('.monaco-editor').first();
  await expect(requestEditor).toContainText('"uri": "/editable-console"');
  await expect(requestEditor).not.toContainText('"id":');
  await expect(requestEditor).not.toContainText('"create_time":');
  await expect(requestEditor).not.toContainText('"update_time":');

  await page.getByRole('button', { name: 'Use raw response' }).click();
  await expect(requestEditor).toContainText('"id": "editable-console-route"');
  await expect(requestEditor).toContainText('"create_time": 1710000000');
});

test('keeps blocked request body errors visible with recovery actions', async ({
  page,
}) => {
  const routeId = 'invalid-json-console-route';
  let blockedRequests = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'PUT' &&
      request.url().includes(`/apisix/admin/routes/${routeId}`)
    ) {
      blockedRequests += 1;
    }
  });

  await page.getByRole('combobox', { name: /Path suffix/ }).fill(routeId);

  const requestEditor = page.locator('.monaco-editor').first();
  await uiFillMonacoEditor(page, requestEditor, '{');

  await page.getByRole('button', { name: /Send PUT/ }).click();
  await page
    .getByRole('dialog', { name: `PUT /routes/${routeId}` })
    .getByRole('button', { name: 'Execute' })
    .click();

  const requestBodyError = page.getByRole('alert').filter({
    hasText: 'Resolve APISIX schema issues before sending.',
  });
  await expect(requestBodyError).toBeVisible();
  await expect(
    requestBodyError.getByRole('button', { name: 'Format Request JSON' })
  ).toBeVisible();
  await expect(
    requestBodyError.getByRole('button', { name: 'Reset to template' })
  ).toBeVisible();
  expect(blockedRequests).toBe(0);

  await requestBodyError.getByRole('button', { name: 'Reset to template' }).click();
  await page.getByRole('dialog', { name: 'Replace request draft?' }).getByRole('button', { name: 'Discard and replace' }).click();
  await expect(requestBodyError).toBeHidden();
  await expect(requestEditor).toContainText('"uri": "/"');
});

test('executes confirmed PUT requests with JSON body and history', async ({
  page,
}) => {
  const routeId = 'raw-console-route';
  const routePayload = {
    uri: '/raw-console',
    name: 'Raw Console Route',
  };

  await page.getByRole('combobox', { name: /Path suffix/ }).fill(routeId);

  const requestEditor = page.locator('.monaco-editor').first();
  await uiFillMonacoEditor(page, requestEditor, JSON.stringify(routePayload));

  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' &&
      request.url().includes(`/apisix/admin/routes/${routeId}`)
  );
  await page.getByRole('button', { name: /Send PUT/ }).click();
  await page
    .getByRole('dialog', { name: `PUT /routes/${routeId}` })
    .getByRole('button', { name: 'Execute' })
    .click();

  const request = await requestPromise;
  expect(request.headers()['x-api-key']).toBe(expectedAdminKey);
  expect(request.postDataJSON()).toMatchObject(routePayload);
  await expect(
    page.locator('.ant-tag').filter({ hasText: '200' }).first()
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'History (1)' })).toBeVisible();

  await page.getByRole('button', { name: 'History (1)' }).click();
  await expect(
    page.getByRole('button', {
      name: /PUT \/routes\/raw-console-route 200/,
    })
  ).toBeVisible();
});
