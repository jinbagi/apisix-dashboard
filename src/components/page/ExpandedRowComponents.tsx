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
import { Link } from '@tanstack/react-router';
import { Tag, Typography } from 'antd';

import type { APISIXType } from '@/types/schema/apisix';
import { formatUpstreamNodeAddress } from '@/utils/upstreamNodes';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ minWidth: 0 }}>
    <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-sm)', display: 'block', marginBottom: 4 }}>
      {title}
    </Typography.Text>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {children}
    </div>
  </div>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Typography.Text style={{ fontSize: 'var(--app-font-size-md)', overflowWrap: 'anywhere' }}>
    <strong>{label}:</strong> {children}
  </Typography.Text>
);

const PluginsSection = ({ plugins }: { plugins?: Record<string, unknown> }) => {
  if (!plugins) return null;
  const entries = Object.entries(plugins);
  if (entries.length === 0) return null;
  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-sm)', display: 'block', marginBottom: 4 }}>
        Plugins ({entries.length})
      </Typography.Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {entries.map(([name, cfg]) => {
          const cfgEntries = cfg && typeof cfg === 'object'
            ? Object.entries(cfg as Record<string, unknown>).slice(0, 3)
            : [];
          return (
            <Tag key={name} style={{ fontSize: 'var(--app-font-size-sm)', padding: '2px 8px' }}>
              <strong>{name}</strong>
              {cfgEntries.length > 0 && (
                <span style={{ marginLeft: 6, color: 'var(--ant-color-text-secondary)' }}>
                  {cfgEntries.map(([k, v]) => `${k}=${typeof v === 'object' ? '...' : v}`).join(' ')}
                </span>
              )}
            </Tag>
          );
        })}
      </div>
    </div>
  );
};

const LabelsSection = ({ labels }: { labels?: Record<string, string> }) => {
  if (!labels || Object.keys(labels).length === 0) return null;
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-sm)', display: 'block', marginBottom: 4 }}>
        Labels
      </Typography.Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {Object.entries(labels).map(([k, v]) => (
          <Tag key={k} style={{ fontSize: 'var(--app-font-size-xs)' }}>{k}={v}</Tag>
        ))}
      </div>
    </div>
  );
};

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: 16,
      padding: '8px 0',
    }}
  >
    {children}
  </div>
);

export const ServiceExpandedRow = ({ service }: { service: APISIXType['Service'] }) => (
  <Grid>
    <Section title="Configuration">
      <Field label="Hosts">{service.hosts?.join(', ') || '-'}</Field>
      {service.upstream_id && (
        <Field label="Upstream">
          <Link to="/upstreams/detail/$id" params={{ id: service.upstream_id }}>{service.upstream_id}</Link>
        </Field>
      )}
      {service.upstream?.nodes && (
        <Field label="Inline Nodes">
          {Array.isArray(service.upstream.nodes)
            ? service.upstream.nodes.map(formatUpstreamNodeAddress).join(', ')
            : Object.keys(service.upstream.nodes).join(', ')}
        </Field>
      )}
      <Field label="WebSocket">{service.enable_websocket ? 'Yes' : 'No'}</Field>
    </Section>
    <LabelsSection labels={service.labels} />
    <PluginsSection plugins={service.plugins} />
  </Grid>
);

export const UpstreamExpandedRow = ({ upstream }: { upstream: APISIXType['Upstream'] }) => {
  const nodes: string[] = [];
  if (upstream.nodes) {
    if (Array.isArray(upstream.nodes)) {
      for (const n of upstream.nodes) nodes.push(`${formatUpstreamNodeAddress(n)} (w:${n.weight})`);
    } else {
      for (const [addr, weight] of Object.entries(upstream.nodes)) nodes.push(`${addr} (w:${weight})`);
    }
  }
  return (
    <Grid>
      <Section title="Nodes">
        {nodes.length > 0 ? nodes.map((n) => (
          <Typography.Text key={n} code style={{ fontSize: 'var(--app-font-size-sm)' }}>{n}</Typography.Text>
        )) : <Typography.Text type="secondary">No nodes</Typography.Text>}
      </Section>
      <Section title="Configuration">
        <Field label="Type">{upstream.type || 'roundrobin'}</Field>
        <Field label="Scheme">{upstream.scheme || 'http'}</Field>
        <Field label="Pass Host">{upstream.pass_host || 'pass'}</Field>
        {upstream.retries !== undefined && <Field label="Retries">{upstream.retries}</Field>}
        {upstream.checks && <Field label="Health Check">Configured</Field>}
      </Section>
      <LabelsSection labels={upstream.labels} />
    </Grid>
  );
};

export const ConsumerExpandedRow = ({ consumer }: { consumer: APISIXType['Consumer'] }) => (
  <Grid>
    <Section title="Details">
      <Field label="Username">{consumer.username}</Field>
      {consumer.desc && <Field label="Description">{consumer.desc}</Field>}
      {consumer.group_id && (
        <Field label="Group">
          <Link to="/consumer_groups/detail/$id" params={{ id: consumer.group_id }}>{consumer.group_id}</Link>
        </Field>
      )}
    </Section>
    <PluginsSection plugins={consumer.plugins} />
    <LabelsSection labels={consumer.labels} />
  </Grid>
);

export const SSLExpandedRow = ({ ssl }: { ssl: Record<string, unknown> }) => {
  const snis = (ssl.snis as string[]) ?? (ssl.sni ? [ssl.sni as string] : []);
  const validityStart = ssl.validity_start as number | undefined;
  const validityEnd = ssl.validity_end as number | undefined;
  return (
    <Grid>
      <Section title="SNIs">
        {snis.length > 0 ? snis.map((s) => (
          <Typography.Text key={s} code style={{ fontSize: 'var(--app-font-size-sm)' }}>{s}</Typography.Text>
        )) : <Typography.Text type="secondary">-</Typography.Text>}
      </Section>
      <Section title="Validity">
        {validityStart && <Field label="From">{new Date(validityStart * 1000).toISOString().slice(0, 10)}</Field>}
        {validityEnd && <Field label="Until">{new Date(validityEnd * 1000).toISOString().slice(0, 10)}</Field>}
        <Field label="Type">{String(ssl.type || 'server')}</Field>
      </Section>
      <LabelsSection labels={ssl.labels as Record<string, string> | undefined} />
    </Grid>
  );
};

export const StreamRouteExpandedRow = ({ route }: { route: APISIXType['StreamRoute'] }) => (
  <Grid>
    <Section title="Server">
      {route.server_addr && <Field label="Server Addr">{route.server_addr}</Field>}
      {route.server_port && <Field label="Server Port">{route.server_port}</Field>}
      {route.remote_addr && <Field label="Remote Addr">{route.remote_addr}</Field>}
      {route.sni && <Field label="SNI">{route.sni}</Field>}
    </Section>
    <Section title="Backend">
      {route.service_id && (
        <Field label="Service">
          <Link to="/services/detail/$id" params={{ id: route.service_id }}>{route.service_id}</Link>
        </Field>
      )}
      {route.upstream_id && (
        <Field label="Upstream">
          <Link to="/upstreams/detail/$id" params={{ id: route.upstream_id }}>{route.upstream_id}</Link>
        </Field>
      )}
    </Section>
    <LabelsSection labels={route.labels} />
    <PluginsSection plugins={route.plugins} />
  </Grid>
);

export const ConsumerGroupExpandedRow = ({ group }: { group: APISIXType['ConsumerGroup'] }) => (
  <Grid>
    <Section title="Details">
      {group.desc && <Field label="Description">{group.desc}</Field>}
    </Section>
    <PluginsSection plugins={group.plugins} />
    <LabelsSection labels={group.labels} />
  </Grid>
);

export const GlobalRuleExpandedRow = ({ rule }: { rule: APISIXType['GlobalRule'] }) => (
  <Grid>
    <PluginsSection plugins={rule.plugins} />
  </Grid>
);

export const PluginConfigExpandedRow = ({ config }: { config: APISIXType['PluginConfig'] }) => (
  <Grid>
    <Section title="Details">
      {config.desc && <Field label="Description">{config.desc}</Field>}
    </Section>
    <PluginsSection plugins={config.plugins} />
    <LabelsSection labels={config.labels} />
  </Grid>
);
