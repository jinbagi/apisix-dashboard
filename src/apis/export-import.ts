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
import { getConsumerGroupListReq } from '@/apis/consumer_groups';
import { getConsumerListReq } from '@/apis/consumers';
import { getCredentialListReq } from '@/apis/credentials';
import { fetchAllResources } from '@/apis/fetchAll';
import { getGlobalRuleListReq } from '@/apis/global_rules';
import { getGraphqlCostDecorations, graphqlCostDecorationsApi } from '@/apis/graphql_cost_decorations';
import { getPluginConfigListReq } from '@/apis/plugin_configs';
import { getProtoListReq } from '@/apis/protos';
import { getRouteListReq } from '@/apis/routes';
import { getSecretListReq } from '@/apis/secrets';
import { getServiceListReq } from '@/apis/services';
import { getSSLListReq } from '@/apis/ssls';
import { getStreamRouteListReq } from '@/apis/stream_routes';
import { getUpstreamListReq } from '@/apis/upstreams';
import {
  API_CONFIG_VALIDATE,
  API_CONSUMER_GROUPS,
  API_CONSUMERS,
  API_GLOBAL_RULES,
  API_PLUGIN_CONFIGS,
  API_PLUGIN_METADATA,
  API_PLUGINS,
  API_PROTOS,
  API_ROUTES,
  API_SECRETS,
  API_SERVICES,
  API_SSLS,
  API_STREAM_ROUTES,
  API_UPSTREAMS,
  SKIP_INTERCEPTOR_HEADER,
} from '@/config/constant';
import { req } from '@/config/req';
import type { APISIXType } from '@/types/schema/apisix';
import { GraphqlCostDecoration } from '@/types/schema/apisix/graphql_cost_decorations';
import { isRecord } from '@/utils/apisixEditable';

export const EXPORT_VERSION = 3;

export type ExportData = {
  version: number;
  exportedAt: string;
  skippedResources?: string[];
  resources: {
    upstreams: Record<string, unknown>[];
    services: Record<string, unknown>[];
    graphqlCostDecorations?: Record<string, unknown>[];
    routes: Record<string, unknown>[];
    streamRoutes: Record<string, unknown>[];
    consumers: Record<string, unknown>[];
    credentials: Record<string, unknown>[];
    consumerGroups: Record<string, unknown>[];
    ssls: Record<string, unknown>[];
    globalRules: Record<string, unknown>[];
    pluginConfigs: Record<string, unknown>[];
    pluginMetadata: Record<string, unknown>[];
    protos: Record<string, unknown>[];
    secrets: Record<string, unknown>[];
  };
};

export type ResourceKey = keyof ExportData['resources'];

export type ConfigValidationError = {
  resource_type?: string;
  resource_id?: string;
  index?: number;
  error: string;
};

export type ConfigValidationResult = {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings?: string[];
};

export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  upstreams: 'Upstreams',
  services: 'Services',
  graphqlCostDecorations: 'GraphQL Cost Decorations',
  routes: 'Routes',
  streamRoutes: 'Stream Routes',
  consumers: 'Consumers',
  credentials: 'Consumer Credentials',
  consumerGroups: 'Consumer Groups',
  ssls: 'SSLs',
  globalRules: 'Global Rules',
  pluginConfigs: 'Plugin Configs',
  pluginMetadata: 'Plugin Metadata',
  protos: 'Protos',
  secrets: 'Secrets',
};

// Import order matters: upstreams before services, services before routes, etc.
export const IMPORT_ORDER: ResourceKey[] = [
  'upstreams',
  'services',
  'graphqlCostDecorations',
  'consumerGroups',
  'consumers',
  'credentials',
  'ssls',
  'globalRules',
  'pluginConfigs',
  'pluginMetadata',
  'protos',
  'secrets',
  'routes',
  'streamRoutes',
];

const RESOURCE_API_MAP: Record<ResourceKey, string> = {
  upstreams: API_UPSTREAMS,
  services: API_SERVICES,
  graphqlCostDecorations: '',
  routes: API_ROUTES,
  streamRoutes: API_STREAM_ROUTES,
  consumers: API_CONSUMERS,
  credentials: '',
  consumerGroups: API_CONSUMER_GROUPS,
  ssls: API_SSLS,
  globalRules: API_GLOBAL_RULES,
  pluginConfigs: API_PLUGIN_CONFIGS,
  pluginMetadata: API_PLUGIN_METADATA,
  protos: API_PROTOS,
  secrets: API_SECRETS,
};

export const getExportResourceKey = (apiBase: string): ResourceKey | undefined =>
  (Object.keys(RESOURCE_API_MAP) as ResourceKey[]).find(
    (key) => !!apiBase && RESOURCE_API_MAP[key] === apiBase
  );

/** Export exactly the chosen resources; references and child collections stay external. */
export async function exportSelectedResources(apiBase: string, selectedIds: string[]): Promise<ExportData> {
  const resourceKey = getExportResourceKey(apiBase);
  const ids = [...new Set(selectedIds)];
  if (!resourceKey || !ids.length) throw new Error('Select resources to export.');
  const items: Record<string, unknown>[] = [];
  for (let offset = 0; offset < ids.length; offset += 4) {
    const batch = await Promise.all(ids.slice(offset, offset + 4).map(async (id) => {
      const segments = apiBase === API_SECRETS ? id.split('/') : [id];
      if (segments.some((segment) => !segment || segment === '.' || segment === '..') ||
        (apiBase === API_SECRETS && segments.length !== 2)) {
        throw new Error(`Invalid resource identity: ${id}`);
      }
      try {
        const response = await req.get(`${apiBase}/${segments.map(encodeURIComponent).join('/')}`);
        if (!isRecord(response.data?.value)) throw new Error('No resource value returned');
        const identity = apiBase === API_SECRETS
          ? { manager: segments[0], id: segments[1] }
          : apiBase === API_CONSUMERS ? { username: id } : { id };
        return { ...response.data.value, ...identity };
      } catch {
        throw new Error(`Could not read ${id}. No file was exported. Retry after refreshing the list.`);
      }
    }));
    items.push(...batch);
  }
  const resources: ExportData['resources'] = {
    upstreams: [], services: [], graphqlCostDecorations: [], routes: [], streamRoutes: [],
    consumers: [], credentials: [], consumerGroups: [], ssls: [], globalRules: [],
    pluginConfigs: [], pluginMetadata: [], protos: [], secrets: [],
  };
  resources[resourceKey] = items;
  return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), resources };
}

const VALIDATION_RESOURCE_KEYS: Record<ResourceKey, string | null> = {
  upstreams: 'upstreams',
  services: 'services',
  graphqlCostDecorations: null,
  routes: 'routes',
  streamRoutes: 'stream_routes',
  consumers: 'consumers',
  credentials: 'consumers',
  consumerGroups: 'consumer_groups',
  ssls: 'ssls',
  globalRules: 'global_rules',
  pluginConfigs: 'plugin_configs',
  pluginMetadata: 'plugin_metadata',
  protos: 'protos',
  secrets: 'secrets',
};

function getCredentialValidationItem(
  item: Record<string, unknown>
): Record<string, unknown> {
  const { username, ...credential } = item;
  const id = String(credential.id ?? '');
  return {
    ...credential,
    id: id.includes('/credentials/')
      ? id
      : `${String(username ?? '')}/credentials/${id}`,
  };
}

export const buildConfigValidationPayload = (
  data: ExportData,
  selectedResources: ResourceKey[] = IMPORT_ORDER
): Record<string, Record<string, unknown>[]> => {
  const payload: Record<string, Record<string, unknown>[]> = {};

  for (const resourceType of selectedResources) {
    const key = VALIDATION_RESOURCE_KEYS[resourceType];
    // APISIX 3.19's batch validator does not handle this nested resource.
    if (!key) continue;
    const items = data.resources[resourceType] ?? [];
    const normalizedItems =
      resourceType === 'credentials'
        ? items.map(getCredentialValidationItem)
        : items;
    payload[key] = [...(payload[key] ?? []), ...normalizedItems];
  }

  return payload;
};

export async function validateConfiguration(
  data: ExportData,
  selectedResources: ResourceKey[] = IMPORT_ORDER
): Promise<ConfigValidationResult> {
  const decorations = selectedResources.includes('graphqlCostDecorations') ? data.resources.graphqlCostDecorations ?? [] : [];
  const warnings = decorations.length ? ['GraphQL cost decorations are checked against the 3.19 schema locally. APISIX checks Service ownership and duplicate field paths when they are imported.'] : [];
  const errors: ConfigValidationError[] = [];
  for (const [index, item] of decorations.entries()) {
    const result = GraphqlCostDecoration.required({ id: true, service_id: true }).safeParse(item);
    if (!result.success) errors.push({ resource_type: 'graphqlCostDecorations', index, error: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
  }
  if (errors.length) return { valid: false, errors, warnings };
  try {
    await req.post(
      API_CONFIG_VALIDATE,
      buildConfigValidationPayload(data, selectedResources)
    );
    return { valid: true, errors: [], warnings };
  } catch (error) {
    const responseData = (
      error as {
        response?: {
          data?: {
            errors?: ConfigValidationError[];
            error_msg?: string;
          };
        };
      }
    ).response?.data;
    const errors = responseData?.errors;
    if (Array.isArray(errors)) return { valid: false, errors };

    return {
      valid: false,
      errors: [
        {
          error:
            responseData?.error_msg ??
            (error instanceof Error ? error.message : String(error)),
        },
      ],
    };
  }
}

export async function exportAllResources(): Promise<ExportData> {
  const results = await Promise.allSettled([
    fetchAllResources(getUpstreamListReq),
    fetchAllResources(getServiceListReq),
    fetchAllResources(getRouteListReq),
    fetchAllResources(getStreamRouteListReq),
    fetchAllResources(getConsumerListReq),
    fetchAllResources(getConsumerGroupListReq),
    fetchAllResources(getSSLListReq),
    fetchAllResources(getGlobalRuleListReq),
    fetchAllResources(getPluginConfigListReq),
    fetchAllResources(getProtoListReq),
    fetchAllResources(getSecretListReq),
  ]);
  const resourceNames: ResourceKey[] = [
    'upstreams', 'services', 'routes', 'streamRoutes', 'consumers',
    'consumerGroups', 'ssls', 'globalRules', 'pluginConfigs', 'protos', 'secrets',
  ];
  const v = (i: number) => results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<Record<string, unknown>[]>).value : [];
  const skipped = resourceNames.filter((_, i) => results[i].status === 'rejected');
  const consumers = v(4);
  const extendedResults = await Promise.allSettled([
    exportCredentials(consumers),
    exportPluginMetadata(),
    exportGraphqlCostDecorations(v(1)),
  ]);
  if (
    extendedResults[0].status === 'rejected' ||
    extendedResults[0].value.hadFailures
  ) {
    skipped.push('credentials');
  }
  if (
    extendedResults[1].status === 'rejected' ||
    extendedResults[1].value.hadFailures
  ) {
    skipped.push('pluginMetadata');
  }
  const credentials =
    extendedResults[0].status === 'fulfilled' ? extendedResults[0].value.items : [];
  const pluginMetadata =
    extendedResults[1].status === 'fulfilled' ? extendedResults[1].value.items : [];
  if (results[1].status === 'rejected' || extendedResults[2].status === 'rejected' || extendedResults[2].value.hadFailures) skipped.push('graphqlCostDecorations');
  const graphqlCostDecorations = extendedResults[2].status === 'fulfilled' ? extendedResults[2].value.items : [];

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    skippedResources: skipped,
    resources: {
      upstreams: v(0), services: v(1), graphqlCostDecorations, routes: v(2), streamRoutes: v(3),
      consumers, credentials, consumerGroups: v(5), ssls: v(6),
      globalRules: v(7), pluginConfigs: v(8), pluginMetadata, protos: v(9),
      secrets: v(10),
    },
  };
}

async function exportGraphqlCostDecorations(services: Record<string, unknown>[]) {
  const results = await Promise.allSettled(services.map(async (service) => {
    const serviceId = String(service.id);
    const response = await getGraphqlCostDecorations(req, serviceId);
    return response.list.map((item) => ({ ...item.value, service_id: serviceId }));
  }));
  return {
    items: results.flatMap((result) => result.status === 'fulfilled' ? result.value : []),
    hadFailures: results.some((result) => result.status === 'rejected'),
  };
}

async function exportCredentials(
  consumers: Record<string, unknown>[]
): Promise<{ items: Record<string, unknown>[]; hadFailures: boolean }> {
  const credentialLists = await Promise.allSettled(
    consumers.map(async (consumer) => {
      const username = String(consumer.username ?? '');
      if (!username) return [];
      const response = await getCredentialListReq(req, { username });
      return getExportedCredentialItems(username, response.list);
    })
  );
  return {
    items: credentialLists.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : []
    ),
    hadFailures: credentialLists.some((result) => result.status === 'rejected'),
  };
}

export function getExportedCredentialItems(
  username: string,
  credentials: Array<{ value: Record<string, unknown> }>
): Record<string, unknown>[] {
  return credentials.map((credential) => ({
    ...credential.value,
    username,
  }));
}

async function exportPluginMetadata(): Promise<{
  items: Record<string, unknown>[];
  hadFailures: boolean;
}> {
  const plugins = await req
    .get<unknown, APISIXType['RespPlugins']>(API_PLUGINS, {
      params: { all: true },
    })
    .then((response) => response.data);
  const pluginNames = Object.entries(plugins)
    .filter(([, plugin]) => plugin.metadata_schema)
    .map(([name]) => name);
  const metadata = await Promise.allSettled(
    pluginNames.map(async (name): Promise<Record<string, unknown> | null> => {
      try {
        const response = await req.get<
          unknown,
          APISIXType['RespPluginMetadataDetail']
        >(`${API_PLUGIN_METADATA}/${name}`, {
          headers: {
            [SKIP_INTERCEPTOR_HEADER]: ['404'],
          },
        });
        return { id: name, ...stripTimestamps(response.data.value) };
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response
          ?.status;
        if (status === 404) return null;
        throw error;
      }
    })
  );
  return {
    items: metadata.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : []
    ),
    hadFailures: metadata.some((result) => result.status === 'rejected'),
  };
}

function stripTimestamps(data: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...data };
  delete copy.create_time;
  delete copy.update_time;
  return copy;
}

export type ImportResult = {
  resourceType: ResourceKey;
  total: number;
  success: number;
  skipped?: number;
  errors: Array<{ id: string; error: string }>;
};

function getCredentialId(item: Record<string, unknown>): string {
  const id = String(item.id ?? '');
  const match = id.match(/(?:^|\/)credentials\/([^/]+)$/);
  return match?.[1] ?? id;
}

function getResourceId(resourceType: ResourceKey, item: Record<string, unknown>): string {
  if (resourceType === 'consumers') return String(item.username ?? item.id ?? '');
  if (resourceType === 'credentials') return getCredentialId(item);
  if (resourceType === 'secrets') {
    // secrets have composite IDs like "vault/1"
    const manager = item.manager ?? '';
    const id = item.id ?? '';
    return manager ? `${manager}/${id}` : String(id);
  }
  return String(item.id ?? '');
}

export function getImportRequest(
  resourceType: ResourceKey,
  item: Record<string, unknown>
): { url: string; body: Record<string, unknown> } {
  if (!isRecord(item)) throw new Error('Resource must be a JSON object');
  const id = getResourceId(resourceType, item);
  if (resourceType === 'graphqlCostDecorations' && (!item.service_id || !id)) {
    throw new Error('GraphQL cost decorations require service_id and id');
  }
  const identifier = resourceType === 'consumers' ? item.username ?? item.id : item.id;
  if (!['string', 'number'].includes(typeof identifier) || !String(identifier).trim()) throw new Error('Resource requires a valid ID');
  if (resourceType === 'secrets' && (!id.includes('/') || id.endsWith('/'))) throw new Error('Secrets require manager and id');
  const body = stripTimestamps(item);
  delete body.id;
  if (resourceType !== 'consumers') delete body.username;
  else body.username = id;
  delete body.manager;

  if (resourceType === 'credentials') {
    const username = String(item.username ?? '');
    if (!username) throw new Error('Consumer credentials require username');
    return {
      url: `${API_CONSUMERS}/${encodeURIComponent(username)}/credentials/${encodeURIComponent(id)}`,
      body,
    };
  }

  if (resourceType === 'graphqlCostDecorations') {
    const serviceId = String(item.service_id ?? '');
    if (!serviceId || !id) throw new Error('GraphQL cost decorations require service_id and id');
    delete body.service_id;
    return { url: `${graphqlCostDecorationsApi(serviceId)}/${encodeURIComponent(id)}`, body };
  }

  return {
    url: `${RESOURCE_API_MAP[resourceType]}/${resourceType === 'secrets' ? id.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(id)}`,
    body,
  };
}

export async function importResources(
  data: ExportData,
  selectedResources: ResourceKey[],
  onProgress?: (result: ImportResult) => void,
  beforeWrite?: (resourceType: ResourceKey, item: Record<string, unknown>, index: number) => Promise<boolean>,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];

  for (const resourceType of IMPORT_ORDER) {
    if (!selectedResources.includes(resourceType)) continue;

    const items = data.resources[resourceType] ?? [];
    if (items.length === 0) {
      const result: ImportResult = { resourceType, total: 0, success: 0, errors: [] };
      results.push(result);
      onProgress?.(result);
      continue;
    }

    const result: ImportResult = { resourceType, total: items.length, success: 0, errors: [] };

    for (const [index, item] of items.entries()) {
      const id = isRecord(item) ? getResourceId(resourceType, item) : `Item ${index + 1}`;
      try {
        const request = getImportRequest(resourceType, item);
        if (beforeWrite && !(await beforeWrite(resourceType, item, index))) {
          result.skipped = (result.skipped ?? 0) + 1;
          continue;
        }
        // Use PUT with ID to create or update
        await req.put(request.url, request.body);
        result.success++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push({ id, error: msg });
      }
    }

    results.push(result);
    onProgress?.(result);
  }

  return results;
}
