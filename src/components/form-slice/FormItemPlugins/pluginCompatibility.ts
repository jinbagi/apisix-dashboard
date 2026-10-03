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

export type PluginCompatibilityNotice = {
  key: string;
  type: 'info' | 'warning';
  message: string;
  description: string;
};

const AI_BINDING_PLUGINS = new Set([
  'ai-aliyun-content-moderation',
  'ai-aws-content-moderation',
  'ai-prompt-guard',
]);

const REDIS_SERVER_NAME_PLUGINS = new Set([
  'ai-cache',
  'ai-rate-limiting',
  'graphql-limit-count',
  'limit-count',
  'limit-conn',
  'limit-req',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasValue = (value: unknown): boolean =>
  typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;

const validateOpenIdConnect = (config: Record<string, unknown>): string[] => {
  if (hasValue(config.client_secret)) return [];

  const bearerOnly = config.bearer_only === true;
  const clientSecretOptional = bearerOnly
    ? hasValue(config.public_key) ||
      config.use_jwks === true ||
      config.introspection_endpoint_auth_method === 'private_key_jwt'
    : config.token_endpoint_auth_method === 'private_key_jwt' ||
      config.use_pkce === true;

  return clientSecretOptional
    ? []
    : [
        'client_secret is required unless the selected OpenID Connect flow uses local JWT verification, private_key_jwt, or non-bearer PKCE.',
      ];
};

const validateLimitCount = (config: Record<string, unknown>): string[] => {
  const redisPolicies = new Set(['redis', 'redis-cluster', 'redis-sentinel']);
  if (!redisPolicies.has(String(config.policy ?? 'local'))) return [];

  const syncInterval = config.sync_interval;
  if (typeof syncInterval !== 'number' || syncInterval === -1) return [];
  if (syncInterval < 0.1) {
    return ['sync_interval must be -1 or at least 0.1 seconds.'];
  }

  const timeWindow = config.time_window;
  return typeof timeWindow === 'number' && syncInterval >= timeWindow
    ? ['sync_interval must be smaller than time_window.']
    : [];
};

export const validatePluginCompatibility = (
  name: string,
  config: Record<string, unknown>
): string[] => {
  if (name === 'openid-connect') return validateOpenIdConnect(config);
  if (name === 'limit-count') return validateLimitCount(config);
  return [];
};

export const getPluginCompatibilityNotices = (
  name: string,
  config: Record<string, unknown>
): PluginCompatibilityNotice[] => {
  const notices: PluginCompatibilityNotice[] = [];

  if (AI_BINDING_PLUGINS.has(name) && (config.fail_mode ?? 'skip') === 'skip') {
    notices.push({
      key: 'ai-fail-mode-skip',
      type: 'warning',
      message: 'Unsupported requests pass through unchecked',
      description:
        'fail_mode defaults to skip. For Consumer-bound policies that must reject non-AI or unsupported request formats, select error. Select warn to allow the request but record the skip.',
    });
  }

  if (name === 'openid-connect') {
    const session = isRecord(config.session) ? config.session : undefined;
    const cookie = session && isRecord(session.cookie) ? session.cookie : undefined;
    if (cookie && hasValue(cookie.lifetime)) {
      notices.push({
        key: 'oidc-cookie-lifetime',
        type: 'warning',
        message: 'session.cookie.lifetime is deprecated',
        description:
          'Move this value to session.absolute_timeout. APISIX currently maps the legacy field only when absolute_timeout is not configured.',
      });
    }
  }

  if (name === 'websocket-proxy') {
    notices.push({
      key: 'websocket-frame-limits',
      type: 'info',
      message: 'Use a ws or wss upstream',
      description:
        'These limits apply to ws/wss frame processing, not the enable_websocket relay. Each direction defaults to 65535 bytes. The receive limit bounds each frame; the relay send limit also bounds a complete message assembled from fragments.',
    });
  }

  if (name === 'openapi-to-mcp') {
    notices.push({
      key: 'mcp-transport',
      type: 'info',
      message: 'Choose the MCP transport for your deployment',
      description:
        'Streamable HTTP is stateless. SSE sessions stay on one APISIX instance and need session affinity behind a load balancer. Replace the OpenAPI document URL and API base URL before saving.',
    });
  }

  if (name === 'graphql-limit-count' && ['complexity', 'node_quantifier'].includes(String(config.cost_strategy))) {
    notices.push({
      key: 'graphql-service-cost',
      type: 'info',
      message: 'Configure cost decorations on the owning Service',
      description:
        'These strategies use Service field decorations and upstream schema introspection. Without decorations, complexity counts nodes and node_quantifier charges 1. Queries above max_cost return 403 after consuming quota.',
    });
  }

  if (name === 'ai-proxy-multi' && Array.isArray(config.fallback_http_statuses) && config.fallback_http_statuses.length > 0) {
    const semantic = isRecord(config.balancer) && config.balancer.algorithm === 'semantic';
    notices.push({
      key: 'ai-status-fallback',
      type: semantic ? 'warning' : 'info',
      message: semantic ? 'Semantic balancing does not retry HTTP failures' : 'Bound retries for selected HTTP statuses',
      description:
        'fallback_http_statuses selects additional 400–599 responses to retry on another instance. max_retries and retry_on_failure_within_ms bound these retries. Semantic balancing does not use this fallback.',
    });
  }

  if (name === 'saml-auth' && hasValue(config.replay_dict)) {
    notices.push({
      key: 'saml-replay-scope',
      type: 'info',
      message: 'Assertion replay records are local to each APISIX node',
      description:
        'replay_dict must name a declared shared dictionary. When it fills, assertions are accepted without recording and APISIX logs an error. Use sp_acs_url for the browser-facing callback URL behind a proxy.',
    });
  }

  if (name === 'batch-requests') {
    notices.push({
      key: 'batch-response-limits',
      type: 'info',
      message: 'Response limits are global plugin metadata',
      description:
        'APISIX 3.19 limits each subresponse to 1 MiB and combined response bodies to 10 MiB by default. Configure positive max_response_body_size and max_response_body_size_total byte values in Plugin Metadata. Exceeding either limit returns 502.',
    });
  }

  if (name === 'chaitin-waf' && isRecord(config.config) && config.config.log_resp === true) {
    notices.push({
      key: 'chaitin-response-log',
      type: 'info',
      message: 'Response reporting is asynchronous',
      description:
        'resp_body_size limits buffered response content in KiB. extra_ignored_content_types excludes additional types. Reporting happens after the client response and does not block or rewrite it.',
    });
  }

  if (REDIS_SERVER_NAME_PLUGINS.has(name) && config.policy === 'redis' && config.redis_ssl === true && config.redis_ssl_verify === true) {
    notices.push({
      key: 'redis-server-name',
      type: 'info',
      message: 'Redis TLS verifies the configured server name',
      description:
        'Set redis_server_name to the certificate DNS name when redis_host is an IP address or alias. Otherwise redis_host supplies the name. IP literals do not enable SNI or a hostname check. Cluster and Sentinel use separate settings.',
    });
  }

  return notices;
};
