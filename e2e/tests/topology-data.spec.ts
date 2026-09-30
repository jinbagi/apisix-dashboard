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

import { buildTopologyData, getUpstreamTargets } from '@/apis/topology';
import type { APISIXType } from '@/types/schema/apisix';

test('maps topology upstream targets from nodes and service discovery', () => {
  expect(
    getUpstreamTargets({
      nodes: [{ host: '10.0.0.10', port: 9080, weight: 1 }],
    })
  ).toEqual(['10.0.0.10:9080']);

  expect(
    getUpstreamTargets({
      nodes: { '10.0.0.11:9080': 1 },
      discovery_type: 'nacos',
      service_name: 'orders',
    })
  ).toEqual(['10.0.0.11:9080', 'nacos:orders']);

  expect(
    getUpstreamTargets({
      discovery_type: 'kubernetes',
      service_name: 'payments',
    })
  ).toEqual(['kubernetes:payments']);
});

test('builds topology data with inline discovery targets and partial failure state', () => {
  const topology = buildTopologyData({
    routes: [
      {
        id: 'route-orders',
        uri: '/orders',
        upstream: {
          discovery_type: 'nacos',
          service_name: 'orders',
        },
        create_time: 1,
        update_time: 2,
      },
    ] satisfies APISIXType['Route'][],
    streamRoutes: [
      {
        id: 'stream-orders',
        desc: 'orders tcp',
        service_id: 'svc-orders',
        upstream: {
          nodes: [{ host: '10.0.0.12', port: 9090, weight: 1 }],
        },
        create_time: 1,
        update_time: 2,
      },
    ] satisfies APISIXType['StreamRoute'][],
    services: [
      {
        id: 'svc-orders',
        name: 'orders service',
        upstream: {
          discovery_type: 'dns',
          service_name: 'orders.internal',
        },
        create_time: 1,
        update_time: 2,
      },
    ] satisfies APISIXType['Service'][],
    upstreams: [
      {
        id: 'upstream-shared',
        name: 'shared upstream',
        nodes: { '10.0.0.13:9080': 1 },
        create_time: 1,
        update_time: 2,
      },
    ] satisfies APISIXType['Upstream'][],
    unavailableResources: ['streamRoutes'],
  });

  expect(topology.routes[0]).toMatchObject({
    hasInlineUpstream: true,
    inlineUpstreamTargets: ['nacos:orders'],
  });
  expect(topology.streamRoutes[0]).toMatchObject({
    hasInlineUpstream: true,
    inlineUpstreamTargets: ['10.0.0.12:9090'],
  });
  expect(topology.services[0]).toMatchObject({
    hasInlineUpstream: true,
    inlineUpstreamTargets: ['dns:orders.internal'],
  });
  expect(topology.upstreams[0].nodes).toEqual(['10.0.0.13:9080']);
  expect(topology.unavailableResources).toEqual(['streamRoutes']);
});

test('retains portless and IPv6 array nodes as topology targets', () => {
  expect(getUpstreamTargets({ nodes: [
    { host: 'example.com', weight: 1 },
    { host: '2001:db8::1', weight: 2 },
    { host: '2001:db8::2', port: 443, weight: 3 },
  ] })).toEqual(['example.com', '2001:db8::1', '[2001:db8::2]:443']);
});
