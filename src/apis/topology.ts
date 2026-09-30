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
import { fetchAllResources } from '@/apis/fetchAll';
import { getRouteListReq } from '@/apis/routes';
import { getServiceListReq } from '@/apis/services';
import { getStreamRouteListReq } from '@/apis/stream_routes';
import { getUpstreamListReq } from '@/apis/upstreams';
import type { APISIXType } from '@/types/schema/apisix';
import { formatUpstreamNodeAddress } from '@/utils/upstreamNodes';

type TopologyResourceKey = 'routes' | 'streamRoutes' | 'services' | 'upstreams';

export type TopologyData = {
  routes: Array<{
    id: string;
    name?: string;
    uri?: string;
    service_id?: string;
    upstream_id?: string;
    hasInlineUpstream: boolean;
    inlineUpstreamTargets: string[];
  }>;
  streamRoutes: Array<{
    id: string;
    name?: string;
    service_id?: string;
    upstream_id?: string;
    hasInlineUpstream: boolean;
    inlineUpstreamTargets: string[];
  }>;
  services: Array<{
    id: string;
    name?: string;
    upstream_id?: string;
    hasInlineUpstream: boolean;
    inlineUpstreamTargets: string[];
  }>;
  upstreams: Array<{ id: string; name?: string; nodes: string[] }>;
  unavailableResources: TopologyResourceKey[];
};

type TopologySourceData = {
  routes: APISIXType['Route'][];
  streamRoutes: APISIXType['StreamRoute'][];
  services: APISIXType['Service'][];
  upstreams: APISIXType['Upstream'][];
  unavailableResources?: TopologyResourceKey[];
};

export function getUpstreamTargets(upstream?: Partial<APISIXType['Upstream']>): string[] {
  try {
    const targets: string[] = [];
    const nodes = upstream?.nodes;
    if (Array.isArray(nodes)) {
      targets.push(
        ...nodes
          .filter((node) => !!node?.host)
          .map(formatUpstreamNodeAddress)
      );
    } else if (nodes && typeof nodes === 'object') {
      targets.push(...Object.keys(nodes));
    }

    const serviceName = upstream?.service_name?.trim();
    const discoveryType = upstream?.discovery_type?.trim();
    if (serviceName || discoveryType) {
      targets.push(`${discoveryType || 'discovery'}${serviceName ? `:${serviceName}` : ''}`);
    }

    return targets;
  } catch {
    return [];
  }
}

export function buildTopologyData(data: TopologySourceData): TopologyData {
  return {
    routes: data.routes.map((r) => {
      const inlineUpstreamTargets = getUpstreamTargets(r.upstream);
      return {
        id: r.id,
        name: r.name,
        uri: r.uri || r.uris?.join(', '),
        service_id: r.service_id,
        upstream_id: r.upstream_id,
        hasInlineUpstream: inlineUpstreamTargets.length > 0,
        inlineUpstreamTargets,
      };
    }),
    streamRoutes: data.streamRoutes.map((r) => {
      const inlineUpstreamTargets = getUpstreamTargets(r.upstream);
      return {
        id: r.id,
        name: r.desc,
        service_id: r.service_id,
        upstream_id: r.upstream_id,
        hasInlineUpstream: inlineUpstreamTargets.length > 0,
        inlineUpstreamTargets,
      };
    }),
    services: data.services.map((s) => {
      const inlineUpstreamTargets = getUpstreamTargets(s.upstream);
      return {
        id: s.id,
        name: s.name,
        upstream_id: s.upstream_id,
        hasInlineUpstream: inlineUpstreamTargets.length > 0,
        inlineUpstreamTargets,
      };
    }),
    upstreams: data.upstreams.map((u) => ({
      id: u.id,
      name: u.name,
      nodes: getUpstreamTargets(u),
    })),
    unavailableResources: data.unavailableResources ?? [],
  };
}

export const getTopologyData = async (): Promise<TopologyData> => {
  const [routesRes, streamRoutesRes, servicesRes, upstreamsRes] = await Promise.allSettled([
    fetchAllResources<APISIXType['Route']>(getRouteListReq),
    fetchAllResources<APISIXType['StreamRoute']>(getStreamRouteListReq),
    fetchAllResources<APISIXType['Service']>(getServiceListReq),
    fetchAllResources<APISIXType['Upstream']>(getUpstreamListReq),
  ]);
  const settledResults = {
    routes: routesRes,
    streamRoutes: streamRoutesRes,
    services: servicesRes,
    upstreams: upstreamsRes,
  };
  const unavailableResources = Object.entries(settledResults)
    .filter(([, result]) => result.status === 'rejected')
    .map(([key]) => key as TopologyResourceKey);

  if (unavailableResources.length === Object.keys(settledResults).length) {
    throw new Error('Failed to fetch topology data - check APISIX connection');
  }

  return buildTopologyData({
    routes: routesRes.status === 'fulfilled' ? routesRes.value : [],
    streamRoutes: streamRoutesRes.status === 'fulfilled' ? streamRoutesRes.value : [],
    services: servicesRes.status === 'fulfilled' ? servicesRes.value : [],
    upstreams: upstreamsRes.status === 'fulfilled' ? upstreamsRes.value : [],
    unavailableResources,
  });
};
