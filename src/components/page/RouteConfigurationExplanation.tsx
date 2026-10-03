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
import { Alert, Button, Descriptions, Modal, Space, Spin, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { readRouteConfiguration, type RouteConfiguration } from '@/apis/route-configuration';
import type { ConfigurationSource, PluginOrigin } from '@/utils/routeConfiguration';

const labels = { routes: 'Route', services: 'Service', plugin_configs: 'Plugin Config', global_rules: 'Global Rule', upstreams: 'Upstream' };
const paths = { routes: '/routes/detail/$id', services: '/services/detail/$id', plugin_configs: '/plugin_configs/detail/$id',
  global_rules: '/global_rules/detail/$id', upstreams: '/upstreams/detail/$id' } as const;
const SourceLink = ({ source }: { source: ConfigurationSource }) => (
  <Link to={paths[source.kind]} params={{ id: source.id }} target="_blank" rel="noopener noreferrer">
    {labels[source.kind]}: {source.id}
  </Link>
);

const Explanation = ({ id }: { id: string }) => {
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<RouteConfiguration>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [json, setJson] = useState<{ title: string; value: unknown }>();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(undefined);
    setError('');
    setJson(undefined);
    readRouteConfiguration(id).then((result) => { if (active) setData(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to read configuration'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, version]);

  const pluginTable = (rows: PluginOrigin[], global = false) => (
    <Table size="small" rowKey={(row) => `${row.source.kind}:${row.source.id}:${row.name}`}
      dataSource={rows} pagination={rows.length > 8 ? { pageSize: 8 } : false} scroll={{ x: 720 }}
      locale={{ emptyText: global ? 'No Global Rule plugins configured' : 'No local plugins configured' }}
      columns={[
        { title: 'Plugin', dataIndex: 'name', key: 'name', width: 170 },
        { title: global ? 'Global source' : 'Selected source', key: 'source', render: (_, row) => <SourceLink source={row.source} /> },
        { title: 'Configuration', key: 'state', render: (_, row) => (
          <Tag color={row.disabled ? 'default' : row.conditional ? 'orange' : 'blue'}>
            {row.disabled ? 'Disabled' : !global && data?.script ? 'Script bypass' : row.conditional ? 'Conditional' : 'Configured'}
          </Tag>
        ) },
        ...(!global ? [{ title: 'Overridden sources', key: 'overridden', render: (_: unknown, row: PluginOrigin) => (
          <Space direction="vertical" size={0}>{row.overridden.length ? row.overridden.map((item) => (
            <SourceLink key={item.source.kind} source={item.source} />
          )) : 'None'}</Space>
        ) }] : []),
        { title: 'Inspect', key: 'inspect', width: 100, render: (_, row) => (
          <Button size="small" onClick={() => setJson({ title: `${row.name} configuration`, value: {
            selected: { source: `${labels[row.source.kind]}: ${row.source.id}`, config: row.value },
            overridden: row.overridden.map((item) => ({ source: `${labels[item.source.kind]}: ${item.source.id}`, config: item.value })),
          } })}>View JSON</Button>
        ) },
      ]} />
  );
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Paragraph style={{ margin: 0 }}>
        Saved configuration only; unsaved form and RAW changes are excluded. This read-only view never applies changes.
        Source links open in a new tab.
      </Typography.Paragraph>
      <Space wrap>
        <Button onClick={() => setVersion((current) => current + 1)} loading={loading}>Refresh sources</Button>
        {data && <Typography.Text type="secondary">Read at {data.readAt}</Typography.Text>}
      </Space>
      {loading && <Spin aria-label="Loading configuration sources" />}
      {error && <Alert type="error" showIcon message="Configuration could not be explained" description={error} />}
      {data && <>
        <Space wrap>{data.sources.map((source) => <Tag key={source.kind}><SourceLink source={source} /></Tag>)}</Space>
        <Descriptions size="small" column={1} bordered items={[
          { key: 'upstream', label: 'Configured upstream', children: data.upstream ? <Space wrap>
            <SourceLink source={data.upstream.source} />
            {data.upstreamResource ? <SourceLink source={data.upstreamResource} /> : <Typography.Text>Inline upstream</Typography.Text>}
            <Button size="small" onClick={() => setJson({ title: 'Configured upstream JSON', value: data.upstreamResource?.value ?? data.upstream?.value })}>View upstream JSON</Button>
          </Space> : 'No upstream configured; a plugin or script may handle the request' },
          { key: 'websocket', label: 'WebSocket', children: <Space wrap>
            <Tag>{data.websocket?.value.enable_websocket === true ? 'Enabled' : 'Disabled'}</Tag>
            {data.websocket ? <SourceLink source={data.websocket} /> : 'Default'}
          </Space> },
        ]} />
        {data.script && <Alert type="warning" showIcon message="Script configuration detected"
          description={<span><SourceLink source={data.script} /> supplies a script. APISIX uses its script path instead of the local plugin chain. Global Rules remain separate.</span>} />}
        <div>
          <Typography.Title level={5}>Local plugin precedence</Typography.Title>
          <Typography.Paragraph>
            Route → Plugin Config → Service. The first configuration for each plugin wins as a whole.
            Disabled winners do not fall back to an overridden source.
          </Typography.Paragraph>
          {pluginTable(data.plugins)}
        </div>
        <div>
          <Typography.Title level={5}>Global Rule plugins</Typography.Title>
          <Typography.Paragraph>
            Evaluated separately from local plugins. A plugin can appear in both tables; its Global Rule configuration is not overridden here.
          </Typography.Paragraph>
          {pluginTable(data.globalPlugins, true)}
        </div>
        <Alert type="info" showIcon message="Configuration explanation, not a request trace"
          description="Consumer and Consumer Group plugins can override local configuration after authentication. Request filters, execution phases, plugin availability and run policies still apply. Plugins such as traffic-split or a script can choose a different upstream. Resources are read separately, so this is not an atomic snapshot." />
      </>}
      <Modal open={Boolean(json)} title={json?.title} width={760} footer={<Button onClick={() => setJson(undefined)}>Close JSON</Button>}
        onCancel={() => setJson(undefined)} destroyOnHidden>
        <pre style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {JSON.stringify(json?.value, null, 2)}
        </pre>
      </Modal>
    </Space>
  );
};

export const RouteConfigurationExplanation = ({ id }: { id: string }) => {
  const [open, setOpen] = useState(false);
  return <>
    <Button size="small" onClick={() => setOpen(true)}>Explain configuration</Button>
    <Modal open={open} title="Route configuration sources" width={1080}
      onCancel={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>Close explanation</Button>} destroyOnHidden>
      {open && <Explanation id={id} />}
    </Modal>
  </>;
};

