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

export type AIGatewayTemplate = {
  key: string;
  label: string;
  description: string;
  config: Record<string, unknown>;
};

const commonLimits = {
  max_req_body_size: 67108864,
  max_stream_duration_ms: 120000,
  max_response_bytes: 10485760,
};

export const isAIGatewayPlugin = (name: string): boolean =>
  name === 'ai-proxy' || name === 'ai-proxy-multi';

export const getAIGatewayTemplates = (
  name: string
): AIGatewayTemplate[] => {
  if (name === 'ai-proxy-multi') {
    return [
      {
        key: 'multi-provider',
        label: 'Multi-provider fallback',
        description: 'Round-robin OpenAI-compatible instances with bounded fallback.',
        config: {
          balancer: { algorithm: 'roundrobin' },
          instances: [
            {
              name: 'primary',
              provider: 'openai',
              weight: 1,
              auth: {
                header: {
                  Authorization: 'Bearer $secret://vault/openai/api-key',
                },
              },
              options: { model: 'gpt-4o-mini' },
            },
            {
              name: 'fallback',
              provider: 'openai-compatible',
              weight: 1,
              auth: {
                header: {
                  Authorization: 'Bearer $secret://vault/fallback/api-key',
                },
              },
              options: { model: 'replace-with-model' },
              override: { endpoint: 'https://llm.example.com/v1/chat/completions' },
            },
          ],
          fallback_strategy: ['http_429', 'http_5xx'],
          max_retries: 1,
          retry_on_failure_within_ms: 3000,
        },
      },
    ];
  }

  if (name !== 'ai-proxy') return [];

  return [
    {
      key: 'openai',
      label: 'OpenAI',
      description: 'Chat Completions with a centrally managed API key.',
      config: {
        provider: 'openai',
        auth: {
          header: {
            Authorization: 'Bearer $secret://vault/openai/api-key',
          },
        },
        options: { model: 'gpt-4o-mini' },
        ...commonLimits,
      },
    },
    {
      key: 'bedrock',
      label: 'Amazon Bedrock',
      description: 'Bedrock Converse/ConverseStream with AWS SigV4 authentication.',
      config: {
        provider: 'bedrock',
        provider_conf: { region: 'us-east-1' },
        auth: {
          aws: {
            access_key_id: '$secret://vault/aws/access-key-id',
            secret_access_key: '$secret://vault/aws/secret-access-key',
          },
        },
        options: {
          model: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        },
        ...commonLimits,
      },
    },
    {
      key: 'openai-compatible',
      label: 'OpenAI-compatible',
      description: 'A custom OpenAI-compatible endpoint and model.',
      config: {
        provider: 'openai-compatible',
        auth: {
          header: {
            Authorization: 'Bearer $secret://vault/llm/api-key',
          },
        },
        options: { model: 'replace-with-model' },
        override: {
          endpoint: 'https://llm.example.com/v1/chat/completions',
        },
        ...commonLimits,
      },
    },
  ];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const validateInstance = (
  config: Record<string, unknown>,
  prefix = ''
): string[] => {
  const issues: string[] = [];
  const provider = config.provider;
  const providerConf = isRecord(config.provider_conf)
    ? config.provider_conf
    : {};
  const auth = isRecord(config.auth) ? config.auth : {};
  const override = isRecord(config.override) ? config.override : {};

  if (provider === 'bedrock') {
    if (!providerConf.region) {
      issues.push(`${prefix}provider_conf.region is required for Bedrock.`);
    }
    if (!isRecord(auth.aws)) {
      issues.push(`${prefix}auth.aws is required for Bedrock.`);
    }
  }

  if (
    provider === 'vertex-ai' &&
    !(providerConf.project_id && providerConf.region) &&
    !override.endpoint
  ) {
    issues.push(
      `${prefix}Vertex AI requires provider_conf.project_id and region, or override.endpoint.`
    );
  }

  if (provider === 'openai-compatible' && !override.endpoint) {
    issues.push(
      `${prefix}override.endpoint is required for an OpenAI-compatible provider.`
    );
  }

  return issues;
};

export const validateAIGatewayConfig = (
  name: string,
  config: Record<string, unknown>
): string[] => {
  if (name === 'ai-proxy') return validateInstance(config);
  if (name !== 'ai-proxy-multi') return [];

  const instances = Array.isArray(config.instances) ? config.instances : [];
  const names = new Set<string>();
  return instances.flatMap((instance, index) => {
    if (!isRecord(instance)) return [`instances[${index}] must be an object.`];
    const issues = validateInstance(instance, `instances[${index}].`);
    if (typeof instance.name === 'string') {
      if (names.has(instance.name)) {
        issues.push(`instances[${index}].name must be unique within instances.`);
      }
      names.add(instance.name);
    }
    return issues;
  });
};
