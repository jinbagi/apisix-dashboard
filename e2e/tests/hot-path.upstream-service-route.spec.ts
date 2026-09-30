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
import { routesPom } from '@e2e/pom/routes';
import { servicesPom } from '@e2e/pom/services';
import { upstreamsPom } from '@e2e/pom/upstreams';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import {
  uiFillMonacoEditor,
  uiGetMonacoEditor,
  uiHasToastMsg,
} from '@e2e/utils/ui';
import { expect } from '@playwright/test';

import { deleteAllRoutes } from '@/apis/routes';
import { deleteAllServices } from '@/apis/services';
import { deleteAllUpstreams } from '@/apis/upstreams';
import { API_SERVICES, API_UPSTREAMS } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

test.afterAll(async () => {
  await deleteAllRoutes(e2eReq);
  await deleteAllServices(e2eReq);
  await deleteAllUpstreams(e2eReq);
});

test('can create upstream -> service -> route', async ({ page }) => {
  test.slow();

  const selectPluginsBtn = page.getByRole('button', {
    name: 'Add Plugin',
  });
  const selectPluginsDialog = page.getByRole('dialog', {
    name: 'Add Plugin',
    exact: true,
  });

  /**
   * 1. Create Upstream
   * Name: HTTPBIN Server
   * Node
   * Host:Port: httpbin.org:443
   * Scheme: HTTPS
   */
  const upstream: Partial<APISIXType['Upstream']> = {
    // will be set in test
    id: undefined,
    name: randomId('HTTPBIN Server'),
    scheme: 'https',
    nodes: [{ host: 'httpbin.org', port: 443 }],
  };

  await test.step('create upstream', async () => {
    // Navigate to the upstream list page
    await upstreamsPom.toIndex(page);
    await upstreamsPom.isIndexPage(page);

    // Click the add upstream button
    await upstreamsPom.getAddUpstreamBtn(page).click();
    await upstreamsPom.isAddPage(page);

    // Fill in basic fields
    await page.getByLabel('Name', { exact: true }).fill(upstream.name);

    // Configure nodes section
    const addNodeBtn = page.getByRole('button', { name: 'Add a Node' });

    // Add node
    await addNodeBtn.click();
    const hostInput = page.getByRole('textbox', {
      name: 'Host',
      exact: true,
    });
    await hostInput.fill(upstream.nodes[0].host);

    const portInput = page.getByRole('spinbutton', { name: 'Port' });
    await portInput.fill(upstream.nodes[0].port.toString());

    // Set scheme to HTTPS
    await page
      .getByRole('combobox', { name: 'Scheme' })
      .locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]'
      )
      .click();
    await page
      .locator(
        `.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title="${upstream.scheme}"]`
      )
      .click();

    const postReq = page.waitForResponse(
      (r) => r.url().includes(API_UPSTREAMS) && r.request().method() === 'POST'
    );
    // Submit the form
    await upstreamsPom.getAddBtn(page).click();

    // Intercept the response, get id from response
    const res = await postReq;
    const data = (await res.json()) as APISIXType['RespUpstreamDetail']['data'];
    expect(data).toHaveProperty('value.id');

    // Wait for success message
    await uiHasToastMsg(page, {
      hasText: 'Upstream created and verified',
    });
    // Verify automatic redirection to detail page
    await upstreamsPom.isDetailPage(page);

    // Get id from url
    const url = page.url();
    const id = url.split('/').pop();
    expect(id).toBeDefined();
    expect(data.value.id).toBe(id);

    // Set id to upstream
    upstream.id = id;

    // Verify the upstream name
    const name = page.getByLabel('Name', { exact: true });
    await expect(name).toHaveValue(upstream.name);

    // Verify scheme
    const schemeField = page.getByRole('combobox', {
      name: 'Scheme',
      exact: true,
    });
    await expect(
      schemeField.locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]'
      )
    ).toContainText(upstream.scheme);
  });

  /**
   * 2. Create Service
   * Name: HTTPBIN Service
   * Upstream: Reference the upstream created above
   * Plugins: Enable limit-count with custom configuration
   */
  const servicePluginName = 'limit-count';
  const service = {
    // will be set in test
    id: undefined,
    name: randomId('HTTPBIN Service'),
    upstream_id: upstream.id,
    plugins: {
      [servicePluginName]: {
        count: 10,
        time_window: 60,
        rejected_code: 429,
        key: 'remote_addr',
        policy: 'local',
      },
    },
  } satisfies Partial<APISIXType['Service']>;

  await test.step('create service', async () => {
    // upstream id should be set
    expect(service.upstream_id).not.toBeUndefined();

    // Navigate to the services list page
    await servicesPom.toIndex(page);
    await servicesPom.isIndexPage(page);

    // Click the add service button
    await servicesPom.getAddServiceBtn(page).click();
    await servicesPom.isAddPage(page);

    // Fill in basic fields
    await page.getByLabel('Name', { exact: true }).first().fill(service.name);

    await page
      .getByRole('combobox', { name: 'Upstream ID' })
      .locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]'
      )
      .click();
    await page.getByRole('combobox', { name: 'Upstream ID', exact: true }).fill(upstream.id);
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ has: page.getByText(upstream.id, { exact: true }) }).click();

    // Add plugins
    await selectPluginsBtn.click();

    // Search for plugin
    const selectPluginsDialog = page.getByRole('dialog', {
      name: 'Add Plugin',
      exact: true,
    });
    const searchInput = selectPluginsDialog.getByPlaceholder(
      'Search by name, capability, or description'
    );
    await searchInput.fill(servicePluginName);

    // Add the plugin
    await selectPluginsDialog
      .getByTestId(`plugin-${servicePluginName}`)
      .getByRole('button', { name: 'Add' })
      .click();

    // Configure the plugin
    const addPluginDialog = page.getByRole('dialog', {
      name: `Add Plugin: ${servicePluginName}`,
    });
    await addPluginDialog.getByRole('tab', { name: 'Plugin JSON' }).click();
    const pluginEditor = await uiGetMonacoEditor(page, addPluginDialog);

    // Add plugin configuration
    await uiFillMonacoEditor(
      page,
      pluginEditor,
      JSON.stringify(service.plugins?.[servicePluginName])
    );

    // Add the plugin
    await addPluginDialog.getByRole('button', { name: 'Add Plugin' }).click();
    await expect(addPluginDialog).toBeHidden();
    await selectPluginsDialog.getByLabel('Close', { exact: true }).click();
    await expect(selectPluginsDialog).toBeHidden();

    // Verify the plugin was added
    await expect(page.getByText(servicePluginName, { exact: true })).toBeVisible();

    const postReq = page.waitForResponse(
      (r) => r.url().includes(API_SERVICES) && r.request().method() === 'POST'
    );
    // Submit the form
    await servicesPom.getAddBtn(page).click();

    // intercept the response, get id from response
    const response = await postReq;
    expect(response.request().postDataJSON().upstream_id).toBe(upstream.id);
    const data =
      (await response.json()) as APISIXType['RespServiceDetail']['data'];
    expect(data).toHaveProperty('value.id');

    // Wait for success message
    await uiHasToastMsg(page, {
      hasText: 'Service created and verified',
    });
    // Verify we're on the service detail page
    await servicesPom.isDetailPage(page);

    // Get id from url
    const url = page.url();
    const id = url.split('/').pop();
    expect(id).toBeDefined();
    expect(data.value.id).toBe(id);

    // Set id to service
    service.id = id;

    // Verify the service name
    const name = page.getByLabel('Name', { exact: true }).first();
    await expect(name).toHaveValue(service.name);
  });

  /**
   * 3. Create Route
   * Name: Generate UUID
   * Uri: /uuid
   * Methods: GET
   * Service: Reference the service created above
   * Plugins: Enable CORS plugin with custom configuration (constraint allow_origins = "httpbin.local")
   */
  const routePluginName = 'cors';
  const route: Partial<APISIXType['Route']> = {
    name: randomId('Generate UUID'),
    uri: '/uuid',
    methods: ['GET'],
    service_id: service.id,
    plugins: {
      [routePluginName]: {
        allow_origins: 'https://httpbin.local:80',
      },
    },
  };

  await test.step('create route', async () => {
    // service id should be set
    expect(route.service_id).not.toBeUndefined();

    // Navigate to the route list page
    await routesPom.toIndex(page);
    await routesPom.isIndexPage(page);

    // Click the add route button
    await routesPom.getAddRouteBtn(page).click();
    await routesPom.isAddPage(page);

    // Fill in basic fields
    await page.getByLabel('Name', { exact: true }).first().fill(route.name);
    await page.getByLabel('URI', { exact: true }).fill(route.uri);

    // Select HTTP methods
    await page
      .getByRole('combobox', { name: 'HTTP Methods' })
      .locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]'
      )
      .click();
    await page.keyboard.type('GET');
    await page.keyboard.press('Enter');

    // Select service reference
    await page
      .getByRole('combobox', { name: 'Service ID' })
      .locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]'
      )
      .click();
    await page.getByRole('combobox', { name: 'Service ID', exact: true }).fill(service.id);
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ has: page.getByText(service.id, { exact: true }) }).click();

    // Add plugins
    await selectPluginsBtn.click();

    // Search for plugin
    const searchInput = selectPluginsDialog.getByPlaceholder(
      'Search by name, capability, or description'
    );
    await searchInput.fill(routePluginName);

    // Add the plugin
    await selectPluginsDialog
      .getByTestId(`plugin-${routePluginName}`)
      .getByRole('button', { name: 'Add' })
      .click();

    // Configure the plugin
    const addPluginDialog = page.getByRole('dialog', {
      name: `Add Plugin: ${routePluginName}`,
    });
    await addPluginDialog.getByRole('tab', { name: 'Plugin JSON' }).click();
    const pluginEditor = await uiGetMonacoEditor(page, addPluginDialog);

    // Add plugin configuration
    await uiFillMonacoEditor(
      page,
      pluginEditor,
      JSON.stringify(route.plugins?.[routePluginName])
    );

    // Add the plugin
    await addPluginDialog.getByRole('button', { name: 'Add Plugin' }).click();
    await expect(addPluginDialog).toBeHidden();
    await selectPluginsDialog.getByLabel('Close', { exact: true }).click();
    await expect(selectPluginsDialog).toBeHidden();

    // Verify the plugin was added
    await expect(page.getByText(routePluginName, { exact: true })).toBeVisible();

    // Submit the form
    const routeResponse = page.waitForResponse((response) => response.url().includes('/apisix/admin/routes') && response.request().method() === 'POST');
    await routesPom.getAddBtn(page).click();
    expect((await routeResponse).request().postDataJSON().service_id).toBe(service.id);

    // Wait for success message
    await uiHasToastMsg(page, {
      hasText: 'Route created and verified',
    });

    // Verify we're on the route detail page
    await routesPom.isDetailPage(page);

    // Verify the route name
    const name = page.getByLabel('Name', { exact: true }).first();
    await expect(name).toHaveValue(route.name);
  });

  /**
   * 4. Verification
   * Ensure all created values exist
   */
  await test.step('verify all created resources', async () => {
    // Verify upstream exists in list
    await upstreamsPom.toIndex(page);
    await upstreamsPom.isIndexPage(page);
    await expect(page.getByRole('cell', { name: upstream.name })).toBeVisible();

    // Verify service exists in list
    await servicesPom.toIndex(page);
    await servicesPom.isIndexPage(page);
    await expect(page.getByRole('cell', { name: service.name })).toBeVisible();

    // Verify route exists in list
    await routesPom.toIndex(page);
    await routesPom.isIndexPage(page);
    await expect(page.getByRole('cell', { name: route.name })).toBeVisible();

    // Navigate to route detail to verify service and plugin
    await page
      .getByRole('row', { name: route.name })
      .getByRole('link', { name: route.name, exact: true })
      .click();
    await routesPom.isDetailPage(page);

    // Verify URI
    const uri = page.getByLabel('URI', { exact: true });
    await expect(uri).toHaveValue(route.uri);

    // Verify HTTP methods
    const methods = page
      .getByRole('combobox', { name: 'HTTP Methods' })
      .locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]'
      );
    await expect(methods).toContainText('GET');

    // Verify CORS plugin is present
    await expect(page.getByText('cors', { exact: true })).toBeVisible();

    // Verify service id is present
    await expect(
      page.getByRole('combobox', { name: 'Service ID' }).locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]'
      )
    ).toContainText(service.id);

    // Navigate to service detail to verify upstream and plugin
    await servicesPom.toIndex(page);
    await servicesPom.isIndexPage(page);
    await page
      .getByRole('row', { name: service.name })
      .getByRole('link', { name: service.name, exact: true })
      .click();

    // Verify limit-count plugin is present
    await expect(page.getByText(servicePluginName, { exact: true })).toBeVisible();

    // Verify upstream id is present
    await expect(
      page.getByRole('combobox', { name: 'Upstream ID' }).locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]'
      )
    ).toContainText(upstream.id);

    // Verify service name is present
    await expect(
      page.getByRole('textbox', { name: 'Name', exact: true }).first()
    ).toHaveValue(service.name);

    // Navigate to upstream detail to verify nodes
    await upstreamsPom.toIndex(page);
    await upstreamsPom.isIndexPage(page);
    await page
      .getByRole('row', { name: upstream.name })
      .getByRole('link', { name: upstream.name, exact: true })
      .click();

    // Verify nodes are present
    await expect(
      page.getByRole('cell', { name: upstream.nodes[0].host })
    ).toBeVisible();

    // Verify upstream name is present
    await expect(
      page.getByRole('textbox', { name: 'Name', exact: true })
    ).toHaveValue(upstream.name);
  });
});
