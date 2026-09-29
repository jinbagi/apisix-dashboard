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
import { pluginMetadataPom } from '@e2e/pom/plugin_metadata';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import {
  uiFillMonacoEditor,
  uiGetMonacoEditor,
  uiHasToastMsg,
} from '@e2e/utils/ui';
import { expect } from '@playwright/test';

import { API_PLUGIN_METADATA } from '@/config/constant';

// Helper function to delete plugin metadata
const deletePluginMetadata = async (req: typeof e2eReq, name: string) => {
  await req.delete(`${API_PLUGIN_METADATA}/${name}`).catch(() => {
    // Ignore errors if metadata doesn't exist
  });
};

test.beforeAll(async () => {
  await deletePluginMetadata(e2eReq, 'http-logger');
});

test.afterAll(async () => {
  await deletePluginMetadata(e2eReq, 'http-logger');
});

test('should CRUD plugin metadata with all fields', async ({ page }) => {
  await pluginMetadataPom.toIndex(page);
  await pluginMetadataPom.isIndexPage(page);

  await test.step('add plugin metadata with comprehensive configuration', async () => {
    // Click Add Plugin button
    await pluginMetadataPom.getSelectPluginsBtn(page).click();

    // Add Plugin dialog should appear
    const selectPluginsDialog = page.getByRole('dialog', {
      name: 'Add Plugin',
      exact: true,
    });
    await expect(selectPluginsDialog).toBeVisible();

    // Search for http-logger plugin
    const searchInput = selectPluginsDialog.getByPlaceholder(
      'Search by name, capability, or description'
    );
    await searchInput.fill('http-logger');

    // Click Add button for http-logger
    await selectPluginsDialog
      .getByTestId('plugin-http-logger')
      .getByRole('button', { name: 'Add' })
      .click();

    // Add Plugin dialog should appear
    const addPluginDialog = page.getByRole('dialog', {
      name: 'Add Plugin: http-logger',
    });
    await expect(addPluginDialog).toBeVisible();
    await addPluginDialog.getByRole('tab', { name: 'Plugin JSON' }).click();

    const pluginEditor = await uiGetMonacoEditor(page, addPluginDialog);
    // Exercise the production editor; its development-only global is unavailable in CI.
    await uiFillMonacoEditor(page, pluginEditor, 'invalid JSON');
    await expect(pluginEditor.getByText('invalid JSON')).toBeVisible();
    await expect(
      addPluginDialog.getByText('Fix Plugin JSON syntax before saving.')
    ).toBeVisible();
    await addPluginDialog.getByRole('button', { name: 'Add Plugin' }).click();
    const jsonErrorAlert = addPluginDialog.getByRole('alert').filter({
      hasText: /Invalid JSON:|JSON format is not valid/,
    });
    await expect(jsonErrorAlert).toBeVisible();
    await expect(
      addPluginDialog.getByRole('button', { name: 'Format Plugin JSON after error' })
    ).toBeVisible();
    await addPluginDialog
      .getByRole('button', { name: 'Reset Plugin JSON after error' })
      .click();
    await expect(jsonErrorAlert).toBeHidden();

    // Fill in comprehensive configuration with all available fields
    await uiFillMonacoEditor(
      page,
      pluginEditor,
      JSON.stringify({
        log_format: {
          host: '$host',
          client_ip: '$remote_addr',
          request_method: '$request_method',
          request_uri: '$request_uri',
          status: '$status',
          body_bytes_sent: '$body_bytes_sent',
          request_time: '$request_time',
          upstream_response_time: '$upstream_response_time',
        },
      })
    );
    await expect(
      addPluginDialog.getByRole('button', { name: 'Format Plugin JSON' })
    ).toBeVisible();
    await expect(
      addPluginDialog.getByRole('button', { name: 'Copy Plugin JSON' })
    ).toBeVisible();
    await expect(
      addPluginDialog.getByRole('button', { name: 'Reset Plugin JSON' })
    ).toBeVisible();
    await addPluginDialog
      .getByRole('button', { name: 'Format Plugin JSON' })
      .click();
    await expect(pluginEditor.getByText('"log_format": {')).toBeVisible();

    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().includes(`${API_PLUGIN_METADATA}/http-logger`)
    );

    // Click Add button
    await addPluginDialog.getByRole('button', { name: 'Add Plugin' }).click();
    const response = await createResponse;
    const requestPayload = response.request().postDataJSON() as Record<
      string,
      unknown
    >;
    expect(requestPayload).toMatchObject({
      log_format: {
        host: '$host',
        client_ip: '$remote_addr',
        request_method: '$request_method',
        request_uri: '$request_uri',
        status: '$status',
        body_bytes_sent: '$body_bytes_sent',
        request_time: '$request_time',
        upstream_response_time: '$upstream_response_time',
      },
    });
    expect(requestPayload).not.toHaveProperty('id');
    expect(requestPayload).not.toHaveProperty('create_time');
    expect(requestPayload).not.toHaveProperty('update_time');

    // Should show success message
    await uiHasToastMsg(page, {
      hasText: 'Plugin Metadata for http-logger saved and verified',
    });

    // Dialog should close
    await expect(addPluginDialog).toBeHidden();

    // Plugin card should now be visible
    const httpLoggerCard = page.getByTestId('plugin-http-logger');
    await expect(httpLoggerCard).toBeVisible();
  });

  await test.step('verify comprehensive configuration can be reopened', async () => {
    // Find the http-logger card
    const httpLoggerCard = page.getByTestId('plugin-http-logger');

    // Click Edit button
    await httpLoggerCard.getByRole('button', { name: 'Edit' }).click();

    // Edit Plugin dialog should appear
    const editPluginDialog = page.getByRole('dialog', {
      name: 'Edit Plugin: http-logger',
    });
    await expect(editPluginDialog).toBeVisible();
    await editPluginDialog.getByRole('tab', { name: 'Plugin JSON' }).click();

    const pluginEditor = await uiGetMonacoEditor(page, editPluginDialog, false);

    await expect(pluginEditor.getByText('"log_format": {')).toBeVisible();
    await expect(
      pluginEditor.getByText('"client_ip": "$remote_addr",')
    ).toBeVisible();
    await expect(pluginEditor.getByText('"host": "$host"')).toBeVisible();

    await editPluginDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(editPluginDialog).toBeHidden();
  });

  await test.step('edit plugin metadata with comprehensive update', async () => {
    const httpLoggerCard = page.getByTestId('plugin-http-logger');
    await httpLoggerCard.getByRole('button', { name: 'Edit' }).click();

    const editPluginDialog = page.getByRole('dialog', {
      name: 'Edit Plugin: http-logger',
    });
    await expect(editPluginDialog).toBeVisible();
    await editPluginDialog.getByRole('tab', { name: 'Plugin JSON' }).click();

    const pluginEditor = await uiGetMonacoEditor(page, editPluginDialog);
    await uiFillMonacoEditor(
      page,
      pluginEditor,
      JSON.stringify({
        log_format: {
          host: '$host',
          service_id: '$service_id',
          route_id: '$route_id',
          latency: '$request_time',
        },
      })
    );

    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().includes(`${API_PLUGIN_METADATA}/http-logger`)
    );
    await editPluginDialog.getByRole('button', { name: 'Save Changes' }).click();

    const response = await saveResponse;
    const requestPayload = response.request().postDataJSON() as Record<
      string,
      unknown
    >;
    expect(requestPayload).toMatchObject({
      log_format: {
        host: '$host',
        service_id: '$service_id',
        route_id: '$route_id',
        latency: '$request_time',
      },
    });
    expect(requestPayload).not.toHaveProperty('id');
    expect(requestPayload).not.toHaveProperty('create_time');
    expect(requestPayload).not.toHaveProperty('update_time');

    await uiHasToastMsg(page, {
      hasText: 'Plugin Metadata for http-logger saved and verified',
    });
    await expect(editPluginDialog).toBeHidden();
  });

  await test.step('delete plugin metadata', async () => {
    // Find the http-logger card
    const httpLoggerCard = page.getByTestId('plugin-http-logger');

    await httpLoggerCard.getByRole('button', { name: 'Remove' }).click();
    await page
      .getByRole('tooltip')
      .getByRole('button', { name: 'Remove' })
      .click();

    // Should show success message
    await uiHasToastMsg(page, {
      hasText: 'Plugin Metadata for http-logger deleted and verified',
    });

    // Card should be removed
    await expect(httpLoggerCard).toBeHidden();
  });
});
