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

import { selectPluginNamesWithSchema } from '../../src/apis/plugins';
import { validateAIGatewayConfig } from '../../src/components/form-slice/FormItemPlugins/aiGateway';
import { getPluginSearchText } from '../../src/components/form-slice/FormItemPlugins/pluginCatalog';
import { getPluginCompatibilityNotices } from '../../src/components/form-slice/FormItemPlugins/pluginCompatibility';
import { getPluginTemplates } from '../../src/components/form-slice/FormItemPlugins/pluginTemplates';
import { type JSONSchema, validateSchemaValue } from '../../src/components/schema-form/schemaValidation';

// APISIX 3.19 public plugin contracts; the UI still uses the connected gateway schema.
const mcpSchema: JSONSchema = {
  type: 'object',
  required: ['openapi_url', 'base_url'],
  properties: {
    transport: { type: 'string', enum: ['sse', 'streamable_http'], default: 'sse' },
    openapi_url: { type: 'string', minLength: 1 },
    base_url: { type: 'string', minLength: 1 },
    flatten_parameters: { type: 'boolean', default: false },
  },
};
const frameLimit: JSONSchema = { type: 'integer', minimum: 1, maximum: 2147483647 };
const websocketSchema: JSONSchema = {
  type: 'object',
  properties: {
    client_max_payload_len: frameLimit,
    upstream_max_payload_len: frameLimit,
  },
};

test('new plugin examples follow enabled schemas and do not create catalog-only plugins', () => {
  expect(getPluginSearchText('openapi-to-mcp')).toContain('openapi');
  expect(getPluginSearchText('websocket-proxy')).toContain('frame');
  expect(selectPluginNamesWithSchema({ 'websocket-proxy': { schema: websocketSchema } }, 'schema'))
    .toEqual(['websocket-proxy']);
  expect(getPluginTemplates('openapi-to-mcp', mcpSchema)).toHaveLength(1);
  expect(getPluginTemplates('openapi-to-mcp', undefined)).toEqual([]);
  expect(getPluginTemplates('openapi-to-mcp', { type: 'object', properties: {} })).toEqual([]);
  expect(getPluginTemplates('openapi-to-mcp', {
    ...mcpSchema,
    properties: { ...mcpSchema.properties, transport: { enum: ['sse'] } },
  })).toEqual([]);
});

test('WebSocket schema accepts asymmetric limits and rejects unencodable frame lengths', () => {
  expect(validateSchemaValue(websocketSchema, {})).toEqual([]);
  expect(validateSchemaValue(websocketSchema, { client_max_payload_len: 1048576 })).toEqual([]);
  expect(validateSchemaValue(websocketSchema, { upstream_max_payload_len: 2147483647 })).toEqual([]);
  expect(validateSchemaValue(websocketSchema, { client_max_payload_len: 2147483648 })).not.toEqual([]);
  expect(validateSchemaValue(websocketSchema, { upstream_max_payload_len: 0 })).not.toEqual([]);
});

test('AI provider names must be unique without rejecting distinct provider configurations', () => {
  const first = { name: 'primary', provider: 'openai', options: { model: 'model-a' } };
  const second = { name: 'primary', provider: 'anthropic', options: { model: 'model-b' } };
  expect(validateAIGatewayConfig('ai-proxy-multi', { instances: [first, second] }))
    .toContain('instances[1].name must be unique within instances.');
  expect(validateAIGatewayConfig('ai-proxy-multi', {
    instances: [first, { ...second, name: 'secondary' }],
  })).toEqual([]);
});

test('explains runtime constraints for cost, retries, and node-local SAML replay protection', () => {
  expect(getPluginCompatibilityNotices('graphql-limit-count', { cost_strategy: 'depth' })).toEqual([]);
  expect(getPluginCompatibilityNotices('graphql-limit-count', { cost_strategy: 'complexity' })[0].description)
    .toContain('after consuming quota');
  expect(getPluginCompatibilityNotices('ai-proxy-multi', {
    fallback_http_statuses: [401], balancer: { algorithm: 'semantic' },
  })[0]).toMatchObject({ type: 'warning', message: 'Semantic balancing does not retry HTTP failures' });
  expect(getPluginCompatibilityNotices('saml-auth', { replay_dict: 'plugin-saml-auth-replay' })[0].description)
    .toContain('accepted without recording');
});

test('Redis and batch guidance keeps global metadata and single-node TLS semantics distinct', () => {
  expect(getPluginCompatibilityNotices('limit-count', {
    policy: 'redis-cluster', redis_ssl: true, redis_ssl_verify: true,
  })).toEqual([]);
  expect(getPluginCompatibilityNotices('limit-count', {
    policy: 'redis', redis_ssl: true, redis_ssl_verify: true,
  })[0].description).toContain('redis_server_name');
  expect(getPluginCompatibilityNotices('batch-requests', {})[0].description)
    .toContain('Plugin Metadata');
});

test('MCP discovery applies the schema-compatible example to editable fields', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/apisix/admin', '');
    const response = path === '/plugins'
      ? { 'openapi-to-mcp': { schema: mcpSchema }, 'websocket-proxy': { schema: websocketSchema } }
      : { list: [], total: 0 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('global_rules/add');
  await page.getByRole('button', { name: 'Add Plugin', exact: true }).click();
  const selector = page.getByRole('dialog', { name: 'Add Plugin', exact: true });
  await selector.getByPlaceholder('Search by name, capability, or description').fill('openapi');
  await selector.getByTestId('plugin-openapi-to-mcp').getByRole('button', { name: 'Add', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Plugin: openapi-to-mcp' });
  await drawer.getByRole('button', { name: 'Streamable HTTP example' }).click();
  await expect(drawer.getByRole('textbox', { name: 'openapi_url', exact: true })).toHaveValue('https://api.example.com/openapi.json');
  await expect(drawer.getByRole('textbox', { name: 'base_url', exact: true })).toHaveValue('https://api.example.com');
  await expect(drawer.getByText('Choose the MCP transport for your deployment')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('apisix-319-mcp-plugin.png'), animations: 'disabled' });
  await drawer.getByRole('button', { name: 'Add Plugin', exact: true }).click();
  await expect(drawer).toBeHidden();
});
