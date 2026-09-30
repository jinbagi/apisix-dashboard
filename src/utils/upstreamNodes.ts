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
import type { APISIXType } from '@/types/schema/apisix';

// A port on an IPv6 address must follow the closing bracket. Unbracketed IPv6
// addresses are kept intact and may rely on APISIX's scheme-specific port.
export const parseUpstreamNodeAddress = (address: string) => {
  const bracketed = address.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) return { host: bracketed[1], ...(bracketed[2] ? { port: Number(bracketed[2]) } : {}) };
  const hostname = address.match(/^([^:]+):(\d+)$/);
  if (hostname) return { host: hostname[1], port: Number(hostname[2]) };
  return { host: address };
};

export const formatUpstreamNodeAddress = (node: Pick<APISIXType['UpstreamNode'], 'host' | 'port'>) => {
  if (node.port === undefined) return node.host;
  const host = node.host.includes(':') && !node.host.startsWith('[') ? `[${node.host}]` : node.host;
  return `${host}:${node.port}`;
};

export const upstreamNodeMapToArray = (nodes: APISIXType['UpstreamNodeObj']) =>
  Object.entries(nodes).map(([address, weight]) => ({ ...parseUpstreamNodeAddress(address), weight }));

export type UpstreamNodeRow = APISIXType['UpstreamNode'] & Record<string, unknown> & { __rowKey: string };

const optionalNumber = (value: unknown) => value === undefined || value === null || value === '' ? undefined : Number(value);

export const upstreamNodeRowsToPayload = (rows: UpstreamNodeRow[]) => rows.map((row) => {
  const node: Record<string, unknown> = { ...row };
  delete node.__rowKey;
  // Preserve metadata and future fields; only the table's own row key is removed.
  return { ...node, port: optionalNumber(node.port), weight: optionalNumber(node.weight), priority: optionalNumber(node.priority) } as APISIXType['UpstreamNode'];
});
