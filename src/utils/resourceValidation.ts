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
    scheme?: string;
    type?: string;
    tls?: { ca_certs?: string[] };
    warm_up_conf?: { slow_start_time_seconds: number; interval?: number };
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
  if (data.tls?.ca_certs && (data.scheme === 'ws' || data.scheme === 'wss')) {
    context.addIssue({ code: 'custom', message: 'WebSocket upstreams use the shared trusted CA configuration; remove per-upstream CA Certificates', path: ['tls', 'ca_certs'] });
  }
  if (data.warm_up_conf) {
    if (data.type && data.type !== 'roundrobin') {
      context.addIssue({ code: 'custom', message: 'Slow start requires roundrobin load balancing', path: ['type'] });
    }
    if ((data.warm_up_conf.interval ?? 1) > data.warm_up_conf.slow_start_time_seconds) {
      context.addIssue({ code: 'custom', message: 'Interval must not exceed slow start time', path: ['warm_up_conf', 'interval'] });
    }
    if (Array.isArray(data.nodes)) {
      const priorities = new Set(data.nodes.map((node) => (node as { priority?: number }).priority ?? 0));
      if (priorities.size > 1) {
        context.addIssue({ code: 'custom', message: 'Slow start requires all nodes to use the same priority', path: ['nodes'] });
      }
    }
  }
};

export const validateInlineUpstream = (
  data: { upstream?: Parameters<typeof validateUpstreamTarget>[0] },
  context: RefinementCtx
) => {
  if (data.upstream) {
    validateUpstreamTarget(data.upstream, {
      ...context,
      addIssue: (issue) => context.addIssue({ ...issue, path: ['upstream', ...(issue.path ?? [])] }),
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
  validateInlineUpstream(data, context);
};

export const validateStreamRouteMatch = (
  data: { sni?: string; snis?: string[]; tls_passthrough?: boolean; upstream?: Parameters<typeof validateUpstreamTarget>[0] },
  context: RefinementCtx
) => {
  if (data.sni?.trim() && data.snis !== undefined) {
    context.addIssue({ code: 'custom', message: 'Use either SNI or SNIs, not both', path: ['sni'] });
  }
  if (data.tls_passthrough && data.upstream?.scheme === 'tls') {
    context.addIssue({ code: 'custom', message: 'TLS passthrough requires a TCP upstream without a second TLS handshake', path: ['upstream', 'scheme'] });
  }
  validateInlineUpstream(data, context);
};

export const validateSSLCertificates = (
  data: { type?: string; sni?: string; snis?: string[]; cert?: string; certs?: string[]; key?: string; keys?: string[]; client?: { ca?: string }; __clientEnabled?: boolean },
  context: RefinementCtx
) => {
  if (!data.cert?.trim()) {
    context.addIssue({ code: 'custom', message: 'Default Certificate is required', path: ['cert'] });
  }
  if (!data.key?.trim()) {
    context.addIssue({ code: 'custom', message: 'Default Private Key is required', path: ['key'] });
  }
  if (data.type !== 'client') {
    const hasSni = !!data.sni?.trim();
    const hasSnis = !!data.snis?.length;
    if (!hasSni && !hasSnis) {
      context.addIssue({ code: 'custom', message: 'A server certificate requires SNI or SNIs', path: ['sni'] });
    }
    if (hasSni && hasSnis) {
      context.addIssue({ code: 'custom', message: 'Use either SNI or SNIs for a server certificate', path: ['sni'] });
    }
    if ((data.certs?.length ?? 0) !== (data.keys?.length ?? 0)) {
      context.addIssue({ code: 'custom', message: 'Additional certificates and private keys must have the same count', path: ['certs'] });
    }
  }
  for (const field of ['certs', 'keys', 'snis'] as const) {
    data[field]?.forEach((value, index) => {
      if (!value.trim()) {
        context.addIssue({ code: 'custom', message: 'Value must not be empty', path: [field, index] });
      }
    });
  }
  if ((data.__clientEnabled || data.client) && !data.client?.ca?.trim()) {
    context.addIssue({ code: 'custom', message: 'Client CA Certificate is required when client certificate verification is enabled', path: ['client', 'ca'] });
  }
};
