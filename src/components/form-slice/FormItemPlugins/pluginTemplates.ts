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

import {
  getSchemaProperties,
  type JSONSchema,
  validateSchemaValue,
} from '@/components/schema-form/schemaValidation';

type PluginTemplate = {
  label: string;
  config: Record<string, unknown>;
};

const templates: Record<string, PluginTemplate[]> = {
  'openapi-to-mcp': [{
    label: 'Streamable HTTP example',
    config: {
      transport: 'streamable_http',
      openapi_url: 'https://api.example.com/openapi.json',
      base_url: 'https://api.example.com',
    },
  }],
  'websocket-proxy': [{
    label: '1 MiB payload limits',
    config: {
      client_max_payload_len: 1048576,
      upstream_max_payload_len: 1048576,
    },
  }],
};

// The connected gateway's schema decides which examples are available.
export const getPluginTemplates = (
  name: string,
  schema: JSONSchema | undefined
): PluginTemplate[] => {
  if (!schema) return [];
  const properties = getSchemaProperties(schema);
  return (templates[name] ?? []).filter(({ config }) =>
    Object.keys(config).every((key) => key in properties) &&
    validateSchemaValue(schema, config).length === 0
  );
};
