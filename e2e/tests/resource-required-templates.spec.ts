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
import { test } from '@e2e/utils/test';
import {
  uiGetMonacoEditor,
  uiSelectByLabel,
} from '@e2e/utils/ui';
import { expect, type Locator, type Page } from '@playwright/test';

const requiredFields = (page: Page) =>
  page.locator('[data-form-field]').evaluateAll((nodes) =>
    nodes
      .filter((node) => node.querySelector('[class*="asterisk"], [aria-required="true"]'))
      .map((node) => node.getAttribute('data-form-field'))
  );

const readMonacoValue = async (page: Page, editor: Locator) => {
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  const value = await page.evaluate(() => navigator.clipboard.readText());
  return value.replace(/\r\n/g, '\n');
};

test('create forms show conditional required fields and minimal JSON templates', async ({
  page,
}) => {
  await page.goto('/ui/routes/add');
  await expect(page.getByRole('heading', { name: 'Add Route' })).toBeVisible();
  await expect.poll(() => requiredFields(page)).toEqual(
    expect.arrayContaining(['uri'])
  );

  await expect.poll(() => requiredFields(page)).not.toContain('uris');

  await page.getByRole('tab', { name: 'Payload JSON' }).click();
  const routeJsonEditor = page.locator(
    '.ant-tabs-tabpane-active .monaco-editor'
  );
  await expect(routeJsonEditor).toBeVisible();
  await expect.poll(() => readMonacoValue(page, routeJsonEditor)).toBe(
    JSON.stringify({ uri: '/' }, null, 2)
  );

  await page.getByRole('tab', { name: 'Visual Editor' }).click();
  await page.locator('input[name="uri"]').fill('/orders');
  await expect.poll(() => requiredFields(page)).not.toContain('uris');
  const uriMatching = page.getByRole('group', { name: 'URI matching', exact: true });
  await uriMatching.getByText('Multiple', { exact: true }).click();
  await expect.poll(() => requiredFields(page)).toContain('uris');
  await expect.poll(() => requiredFields(page)).not.toContain('uri');
  await uriMatching.getByText('Single', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'URI', exact: true })).toHaveValue('/orders');

  await page.getByRole('tab', { name: 'Payload JSON' }).click();
  await expect.poll(async () => {
    const payload = JSON.parse(await readMonacoValue(page, routeJsonEditor)) as {
      uri?: string;
    };
    return payload.uri;
  }).toBe('/orders');

  await page.getByRole('button', { name: 'Apply to Visual Editor' }).click();
  await expect(page.getByRole('tab', { name: 'Visual Editor' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.locator('input[name="uri"]')).toHaveValue('/orders');

  await page.goto('/ui/services/add');
  await page.getByRole('tab', { name: 'Payload JSON' }).click();
  await expect
    .poll(() =>
      readMonacoValue(
        page,
        page.locator('.ant-tabs-tabpane-active .monaco-editor')
      )
    )
    .toBe('{}');

  await page.goto('/ui/upstreams/add');
  await expect.poll(() => requiredFields(page)).toContain('nodes');
  await page.getByRole('tab', { name: 'Payload JSON' }).click();
  await expect
    .poll(() =>
      readMonacoValue(
        page,
        page.locator('.ant-tabs-tabpane-active .monaco-editor')
      )
    )
    .toBe(
    JSON.stringify(
      {
        nodes: [
          {
            host: '127.0.0.1',
            port: 80,
            weight: 1,
          },
        ],
      },
      null,
      2
    )
  );

  await page.getByRole('tab', { name: 'Visual Editor' }).click();
  await uiSelectByLabel(page, 'Discovery Type', 'dns');
  await expect.poll(() => requiredFields(page)).toContain('service_name');

  await page.locator('input[name="service_name"]').fill('orders');
  await expect.poll(() => requiredFields(page)).not.toContain('nodes');
  await expect.poll(() => requiredFields(page)).toEqual(
    expect.arrayContaining(['service_name', 'discovery_type'])
  );
});

test('API Console switches required-only templates with the resource', async ({
  page,
}) => {
  await page.goto('/ui/raw_api');
  const requestEditor = page.locator('.monaco-editor').first();
  await expect.poll(() => readMonacoValue(page, requestEditor)).toBe(
    JSON.stringify({ uri: '/' }, null, 2)
  );

  await uiSelectByLabel(page, 'Resource', 'Services');
  await expect.poll(() => readMonacoValue(page, requestEditor)).toBe('{}');

  await uiSelectByLabel(page, 'Resource', 'Upstreams');
  await expect.poll(() => readMonacoValue(page, requestEditor)).toBe(
    JSON.stringify(
      {
        nodes: [
          {
            host: '127.0.0.1',
            port: 80,
            weight: 1,
          },
        ],
      },
      null,
      2
    )
  );
});

test('plugin add JSON prefills required fields from APISIX schema', async ({
  page,
}) => {
  await page.goto('/ui/plugin_configs/add');
  await expect(page.getByRole('heading', { name: 'Add Plugin Config' })).toBeVisible();

  await page.getByRole('button', { name: 'Add Plugin' }).click();
  const selectPluginsDialog = page.getByRole('dialog', {
    name: 'Add Plugin',
    exact: true,
  });
  await selectPluginsDialog
    .getByPlaceholder('Search by name, capability, or description')
    .fill('limit-count');
  await selectPluginsDialog
    .getByTestId('plugin-limit-count')
    .getByRole('button', { name: 'Add' })
    .click();

  const addPluginDialog = page.getByRole('dialog', {
    name: 'Add Plugin: limit-count',
  });
  await addPluginDialog.getByRole('tab', { name: 'Plugin JSON' }).click();
  const pluginEditor = await uiGetMonacoEditor(page, addPluginDialog, false);

  await expect
    .poll(async () => {
      try {
        const config = JSON.parse(await readMonacoValue(page, pluginEditor)) as Record<
          string,
          unknown
        >;
        return {
          count: config.count,
          time_window: config.time_window,
        };
      } catch {
        return null;
      }
    })
    .toEqual({
      count: 1,
      time_window: 1,
    });

  await addPluginDialog.getByRole('button', { name: 'Apply to Fields' }).click();
  await expect(addPluginDialog.getByRole('tab', { name: 'Fields' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
});
