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
import type { ProColumns } from '@ant-design/pro-components';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Button, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';

import { getRouteListQueryOptions, useRouteList } from '@/apis/hooks';
import type { WithServiceIdFilter } from '@/apis/routes';
import { CopyableID } from '@/components/CopyableID';
import { LabelsDisplay } from '@/components/LabelsDisplay';
import { BulkDeleteBar } from '@/components/page/BulkDeleteBar';
import { LabelSearchInput } from '@/components/page/LabelSearchInput';
import PageHeader from '@/components/page/PageHeader';
import { RawDrawer } from '@/components/page/RawDrawer';
import { RequestMatchPreview } from '@/components/page/RequestMatchPreview';
import { ResourceSortSelect } from '@/components/page/ResourceSortSelect';
import { ResourceTable } from '@/components/page/ResourceTable';
import { RouteOverlapDiagnostics } from '@/components/page/RouteOverlapDiagnostics';
import { SearchInput } from '@/components/page/SearchInput';
import { ToAddPageBtn } from '@/components/page/ToAddPageBtn';
import { StatusSwitch } from '@/components/StatusTag';
import { TableEllipsisText } from '@/components/TableEllipsisText';
import { AntdConfigProvider } from '@/config/antdConfigProvider';
import { API_ROUTES } from '@/config/constant';
import { queryClient } from '@/config/global';
import type { APISIXType } from '@/types/schema/apisix';
import { pageSearchSchema } from '@/types/schema/pageSearch';
import { getPluginFilterOptions, hasPluginName, renderPluginCount, renderUnixDateTime, unixFieldSorter } from '@/utils/columns';
import { formatUpstreamNodeAddress } from '@/utils/upstreamNodes';
import { useBulkActions } from '@/utils/useBulkActions';
import type { ListPageKeys } from '@/utils/useTablePagination';

export type RouteListProps = {
  routeKey: Extract<ListPageKeys, '/routes/' | '/services/detail/$id/routes/'>;
  defaultParams?: Partial<WithServiceIdFilter>;
  detailLink: (id: string) => { to: string; params: Record<string, string> };
  tablePersistenceKey?: string;
};

const RouteExpandedRow = ({ route }: { route: APISIXType['Route'] }) => {
  const plugins = route.plugins ? Object.entries(route.plugins) : [];
  const host = route.host || route.hosts?.join(', ') || '-';
  const methods = route.methods?.join(', ') || 'ANY';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, padding: '8px 0' }}>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-sm)', display: 'block', marginBottom: 4 }}>
          Matching
        </Typography.Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography.Text style={{ fontSize: 'var(--app-font-size-md)' }}>
            <strong>Methods:</strong> {methods}
          </Typography.Text>
          <Typography.Text style={{ fontSize: 'var(--app-font-size-md)' }}>
            <strong>Host:</strong> {host}
          </Typography.Text>
          <Typography.Text style={{ fontSize: 'var(--app-font-size-md)' }}>
            <strong>URI:</strong> <Typography.Text code>{route.uri || route.uris?.join(', ') || '/'}</Typography.Text>
          </Typography.Text>
          {route.remote_addr && (
            <Typography.Text style={{ fontSize: 'var(--app-font-size-md)' }}>
              <strong>Remote Addr:</strong> {route.remote_addr}
            </Typography.Text>
          )}
        </div>
      </div>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-sm)', display: 'block', marginBottom: 4 }}>
          Backend
        </Typography.Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {route.service_id && (
            <Typography.Text style={{ fontSize: 'var(--app-font-size-md)' }}>
              <strong>Service:</strong>{' '}
              <Link to="/services/detail/$id" params={{ id: route.service_id }}>{route.service_id}</Link>
            </Typography.Text>
          )}
          {route.upstream_id && (
            <Typography.Text style={{ fontSize: 'var(--app-font-size-md)' }}>
              <strong>Upstream:</strong>{' '}
              <Link to="/upstreams/detail/$id" params={{ id: route.upstream_id }}>{route.upstream_id}</Link>
            </Typography.Text>
          )}
          {route.upstream?.nodes && (
            <Typography.Text style={{ fontSize: 'var(--app-font-size-md)' }}>
              <strong>Inline nodes:</strong>{' '}
              {Array.isArray(route.upstream.nodes)
                ? route.upstream.nodes.map(formatUpstreamNodeAddress).join(', ')
                : Object.keys(route.upstream.nodes).join(', ')}
            </Typography.Text>
          )}
        </div>
      </div>
      {plugins.length > 0 && (
        <div style={{ gridColumn: '1 / -1' }}>
          <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-sm)', display: 'block', marginBottom: 4 }}>
            Plugins ({plugins.length})
          </Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {plugins.map(([name, cfg]) => {
              const entries = cfg && typeof cfg === 'object' ? Object.entries(cfg as Record<string, unknown>).slice(0, 3) : [];
              return (
                <Tag key={name} style={{ fontSize: 'var(--app-font-size-sm)', padding: '2px 8px' }}>
                  <strong>{name}</strong>
                  {entries.length > 0 && (
                    <span style={{ marginLeft: 6, color: 'var(--ant-color-text-secondary)' }}>
                      {entries.map(([k, v]) => `${k}=${typeof v === 'object' ? '...' : v}`).join(' ')}
                    </span>
                  )}
                </Tag>
              );
            })}
          </div>
        </div>
      )}
      {route.labels && Object.keys(route.labels).length > 0 && (
        <div style={{ gridColumn: '1 / -1' }}>
          <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-sm)', display: 'block', marginBottom: 4 }}>
            Labels
          </Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.entries(route.labels).map(([key, value]) => (
              <Tag key={key} style={{ fontSize: 'var(--app-font-size-xs)' }}>
                {key}={value}
              </Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const RouteList = (props: RouteListProps) => {
  const { routeKey, detailLink, defaultParams, tablePersistenceKey = 'table-v5:routes' } = props;
  const { data, isFetching, refetch, pagination, params, setParams, sortBy, sortOrder, setSort, tableState } = useRouteList(
    routeKey,
    defaultParams
  );
  const { rowSelection, bulkBarProps } = useBulkActions(
    refetch,
    data?.list?.map((record) => record.value.id)
  );
  const [rawTarget, setRawTarget] = useState<{ api: string; title: string; data?: Record<string, unknown> } | null>(null);

  const pluginFilterOptions = useMemo(
    () => getPluginFilterOptions(data?.list),
    [data?.list]
  );

  const columns = useMemo<ProColumns<APISIXType['RespRouteItem']>[]>(() => {
    return [
      {
        title: 'RAW',
        key: 'raw',
        width: 72,
        fixed: 'left',
        render: (_, record) => [
          <Button
            key="raw"
            size="small"
            type="link"
            onClick={() => setRawTarget({ api: `${API_ROUTES}/${record.value.id}`, title: `Route: ${record.value.name || record.value.id}`, data: record.value as Record<string, unknown> })}
          >
            Raw
          </Button>,
        ],
      },
      {
        dataIndex: ['value', 'id'],
        title: 'ID',
        key: 'id',
        width: 120,
        render: (_, record) => <CopyableID id={record.value.id} />,
      },
      {
        dataIndex: ['value', 'name'],
        title: 'Name',
        key: 'name',
        width: 200,
        render: (_, record) => {
          const link = detailLink(record.value.id);
          return (
            <Link to={link.to} params={link.params}>
              <Typography.Text strong>{record.value.name || record.value.id}</Typography.Text>
            </Link>
          );
        },
      },
      {
        dataIndex: ['value', 'host'],
        title: 'Host',
        key: 'host',
        width: 180,
        ellipsis: { showTitle: false },
        render: (_, record) => {
          const host = record.value.host;
          const hosts = record.value.hosts;
          if (host) return <TableEllipsisText value={host} code />;
          if (hosts?.length) {
            const display = `${hosts[0]}${hosts.length > 1 ? ` +${hosts.length - 1}` : ''}`;
            return <TableEllipsisText value={hosts.join(', ')} displayValue={display} code />;
          }
          return <Typography.Text type="secondary">*</Typography.Text>;
        },
      },
      {
        dataIndex: ['value', 'uri'],
        title: 'URI',
        key: 'uri',
        width: 200,
        ellipsis: { showTitle: false },
        render: (_, record) => {
          const uri = record.value.uri;
          const uris = record.value.uris;
          if (uri) return <TableEllipsisText value={uri} code />;
          if (uris?.length) {
            const display = `${uris[0]}${uris.length > 1 ? ` +${uris.length - 1}` : ''}`;
            return <TableEllipsisText value={uris.join(', ')} displayValue={display} code />;
          }
          return '-';
        },
      },
      {
        title: 'Target',
        key: 'target',
        width: 220,
        render: (_, record) => {
          const serviceId = record.value.service_id;
          const upstreamId = record.value.upstream_id;
          if (serviceId) {
            return (
              <Space size={6}>
                <Tag color="green">Service</Tag>
                <Link to="/services/detail/$id" params={{ id: serviceId }}>
                  {serviceId}
                </Link>
              </Space>
            );
          }
          if (upstreamId) {
            return (
              <Space size={6}>
                <Tag color="purple">Upstream</Tag>
                <Link to="/upstreams/detail/$id" params={{ id: upstreamId }}>
                  {upstreamId}
                </Link>
              </Space>
            );
          }
          if (record.value.upstream) {
            return <Tag>Inline Upstream</Tag>;
          }
          return <Typography.Text type="danger">No target</Typography.Text>;
        },
      },
      {
        dataIndex: ['value', 'plugins'],
        title: 'Plugins',
        key: 'plugins',
        width: 120,
        filters: pluginFilterOptions,
        onFilter: (value, record) => hasPluginName(record.value.plugins, value),
        render: (_, record) => renderPluginCount(record.value.plugins),
      },
      {
        dataIndex: ['value', 'priority'],
        title: 'Priority',
        key: 'priority',
        width: 80,
        hideInTable: true,
        renderText: (text) => text ?? 0,
      },
      {
        dataIndex: ['value', 'status'],
        title: 'Status',
        key: 'status',
        width: 100,
        filters: [
          { text: 'Enabled', value: 1 },
          { text: 'Disabled', value: 0 },
        ],
        onFilter: (value, record) => (record.value.status ?? 1) === value,
        render: (_, record) => (
          <StatusSwitch
            status={record.value.status ?? 1}
            api={`${API_ROUTES}/${record.value.id}`}
          />
        ),
      },
      {
        dataIndex: ['value', 'labels'],
        title: 'Labels',
        key: 'labels',
        hideInTable: true,
        render: (_, record) => <LabelsDisplay labels={record.value.labels} />,
      },
      {
        dataIndex: ['value', 'create_time'],
        title: 'Created At',
        key: 'create_time',
        width: 160,
        valueType: 'dateTime',
        defaultSortOrder: 'ascend',
        sorter: unixFieldSorter('create_time'),
        renderText: renderUnixDateTime,
      },
      {
        dataIndex: ['value', 'update_time'],
        title: 'Updated At',
        key: 'update_time',
        width: 160,
        valueType: 'dateTime',
        sorter: unixFieldSorter('update_time'),
        renderText: renderUnixDateTime,
      },
    ];
  }, [detailLink, pluginFilterOptions]);

  return (
    <AntdConfigProvider>
      <ResourceTable
        tableState={tableState}
        resourceName="Routes"
        query={params.q ?? params.name ?? params.uri ?? ''}
        label={params.label ?? ''}
        onClearFilters={() => setParams({ q: undefined, name: undefined, uri: undefined, label: undefined, page: 1 })}
        selectionActions={
          <BulkDeleteBar
            {...bulkBarProps}
            resourceName="Route"
            apiBase={API_ROUTES}
            showStatusActions
          />
        }
        columns={columns}
        dataSource={data?.list}
        rowKey={(record) => record.value.id}
        loading={isFetching}
        search={false}
        rowSelection={rowSelection}
        options={{ density: true, fullScreen: false, reload: () => { void refetch(); }, setting: true }}
        columnsState={{
          persistenceKey: tablePersistenceKey,
          persistenceType: 'localStorage',
          defaultValue: {
            raw: { show: true, fixed: 'left' },
            host: { show: false },
          },
        }}
        dateFormatter="string"
        headerTitle={false}
        pagination={pagination}
        cardProps={{ styles: { body: { padding: 0 } } }}
        scroll={{ x: 'max-content' }}
        expandable={{
          expandedRowRender: (record) => <RouteExpandedRow route={record.value} />,
          rowExpandable: () => true,
        }}
        toolBarRender={() => [
          <SearchInput key="search" defaultValue={params.q ?? params.name ?? params.uri ?? ''} placeholder="Search by name or URI..." onSearch={(q) => setParams({ q, name: undefined, uri: undefined, page: 1 })} />,
          <LabelSearchInput key="label" defaultValue={params.label ?? ''} onSearch={(label) => setParams({ label, page: 1 })} />,
          <ResourceSortSelect key="sort" sortBy={sortBy} sortOrder={sortOrder} onChange={setSort} />,
        ]}
      />
      <RawDrawer
        open={!!rawTarget}
        onClose={() => setRawTarget(null)}
        onSaved={async () => { await refetch(); }}
        api={rawTarget?.api ?? ''}
        title={rawTarget?.title ?? ''}
        initialData={rawTarget?.data}
      />
    </AntdConfigProvider>
  );
};

function RouteComponent() {
  return (
    <>
      <PageHeader
        title="Routes"
        desc="Define how incoming requests are matched, transformed, and forwarded."
        extra={<Space wrap><RequestMatchPreview /><RouteOverlapDiagnostics /><ToAddPageBtn label="Add Route" to="/routes/add" /></Space>}
      />
      <RouteList
        routeKey="/routes/"
        tablePersistenceKey="table-v6:routes"
        detailLink={(id) => ({ to: '/routes/detail/$id', params: { id } })}
      />
    </>
  );
}

export const Route = createFileRoute('/routes/')({
  component: RouteComponent,
  validateSearch: pageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    queryClient.ensureQueryData(getRouteListQueryOptions(deps)),
});
