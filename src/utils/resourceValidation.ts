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
import type { RefinementCtx } from 'zod';

export const validateUpstreamTarget = (
  data: {
    nodes?: unknown[] | Record<string, number>;
    service_name?: string;
    discovery_type?: string;
    pass_host?: string;
    upstream_host?: string;
  },
  context: RefinementCtx
) => {
  const hasNodes = Array.isArray(data.nodes)
    ? data.nodes.length > 0
    : !!data.nodes && Object.keys(data.nodes).length > 0;
  const hasServiceName = !!data.service_name?.trim();
  const hasDiscoveryType = !!data.discovery_type?.trim();

  if (!hasNodes && !(hasServiceName && hasDiscoveryType)) {
    context.addIssue({
      code: 'custom',
      message: 'At least one backend source is required (nodes or service discovery)',
      path: ['nodes'],
    });
  }
  if (hasServiceName !== hasDiscoveryType) {
    context.addIssue({
      code: 'custom',
      message: 'Service Name and Discovery Type must be configured together',
      path: [hasServiceName ? 'discovery_type' : 'service_name'],
    });
  }
  if (data.pass_host === 'rewrite' && !data.upstream_host?.trim()) {
    context.addIssue({
      code: 'custom',
      message: 'Upstream Host is required when Pass Host is rewrite',
      path: ['upstream_host'],
    });
  }
};

export const validateRouteMatch = (
  data: { uri?: string; uris?: string[]; host?: string; hosts?: string[]; remote_addr?: string; remote_addrs?: string[]; upstream?: Parameters<typeof validateUpstreamTarget>[0] },
  context: RefinementCtx
) => {
  if (!data.uri?.trim() && !data.uris?.some((uri) => uri.trim())) {
    context.addIssue({ code: 'custom', message: 'At least one request URI is required (uri or uris)', path: ['uri'] });
  }
  for (const [single, multiple] of [['uri', 'uris'], ['host', 'hosts'], ['remote_addr', 'remote_addrs']] as const) {
    if (data[single]?.trim() && data[multiple]?.length) {
      context.addIssue({ code: 'custom', message: `Use either ${single} or ${multiple}, not both`, path: [single] });
    }
  }
  if (data.upstream) {
    validateUpstreamTarget(data.upstream, {
      ...context,
      addIssue: (issue) => context.addIssue({ ...issue, path: ['upstream', ...(issue.path ?? [])] }),
    });
  }
};

export const validateSSLCertificates = (
  data: { cert?: string; certs?: string[]; key?: string; keys?: string[]; client?: { ca?: string }; __clientEnabled?: boolean },
  context: RefinementCtx
) => {
  if (!data.cert?.trim() && !data.certs?.some((cert) => cert.trim())) {
    context.addIssue({ code: 'custom', message: 'At least one certificate is required (cert or certs)', path: ['cert'] });
  }
  if (!data.key?.trim() && !data.keys?.some((key) => key.trim())) {
    context.addIssue({ code: 'custom', message: 'At least one key is required (key or keys)', path: ['key'] });
  }
  if ((data.__clientEnabled || data.client) && !data.client?.ca?.trim()) {
    context.addIssue({ code: 'custom', message: 'Client CA Certificate is required when client certificate verification is enabled', path: ['client', 'ca'] });
  }
};
