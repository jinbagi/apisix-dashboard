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
import { Button } from 'antd';
import { useMemo, useState } from 'react';

import { getStreamRouteListQueryOptions, useStreamRouteList } from '@/apis/hooks';
import type { WithServiceIdFilter } from '@/apis/routes';
import { CopyableIDLink } from '@/components/CopyableID';
import idClasses from '@/components/CopyableID.module.css';
import { LabelsDisplay } from '@/components/LabelsDisplay';
import { BulkDeleteBar } from '@/components/page/BulkDeleteBar';
import { StreamRouteExpandedRow } from '@/components/page/ExpandedRowComponents';
import { LabelSearchInput } from '@/components/page/LabelSearchInput';
import PageHeader from '@/components/page/PageHeader';
import { RawDrawer } from '@/components/page/RawDrawer';
import { ResourceSortSelect } from '@/components/page/ResourceSortSelect';
import { ResourceTable } from '@/components/page/ResourceTable';
import { SearchInput } from '@/components/page/SearchInput';
import { ToAddPageBtn } from '@/components/page/ToAddPageBtn';
import { StreamRoutesErrorComponent } from '@/components/page-slice/stream_routes/ErrorComponent';
import { TableEllipsisText } from '@/components/TableEllipsisText';
import { AntdConfigProvider } from '@/config/antdConfigProvider';
import { API_STREAM_ROUTES } from '@/config/constant';
import { queryClient } from '@/config/global';
import type { APISIXType } from '@/types/schema/apisix';
import { pageSearchSchema } from '@/types/schema/pageSearch';
import { getPluginFilterOptions, hasPluginName, renderPluginCount, renderUnixDateTime, unixFieldSorter } from '@/utils/columns';
import { useBulkActions } from '@/utils/useBulkActions';
import type { ListPageKeys } from '@/utils/useTablePagination';

export type StreamRouteListProps = {
  routeKey: Extract<
    ListPageKeys,
    '/stream_routes/' | '/services/detail/$id/stream_routes/'
  >;
  detailLink: (record: APISIXType['RespStreamRouteItem']) => React.ReactNode;
  defaultParams?: Partial<WithServiceIdFilter>;
};

export const StreamRouteList = (props: StreamRouteListProps) => {
  const { routeKey, detailLink, defaultParams } = props;
  const { data, isFetching, refetch, pagination, params, setParams, sortBy, sortOrder, setSort, tableState } = useStreamRouteList(
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

  const columns = useMemo<
    ProColumns<APISIXType['RespStreamRouteItem']>[]
  >(() => {
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
            onClick={() => setRawTarget({ api: `${API_STREAM_ROUTES}/${record.value.id}`, title: `Stream Route: ${record.value.id}`, data: record.value as Record<string, unknown> })}
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
        render: (_, record) => (
          <CopyableIDLink id={record.value.id}>
            {detailLink(record)}
          </CopyableIDLink>
        ),
      },
      {
        dataIndex: ['value', 'server_addr'],
        title: 'Server Address',
        key: 'server_addr',
        valueType: 'text',
        render: (_, record) => {
          const v = record.value as APISIXType['StreamRoute'];
          return v.server_addr || '-';
        },
      },
      {
        dataIndex: ['value', 'server_port'],
        title: 'Server Port',
        key: 'server_port',
        valueType: 'text',
        render: (_, record) => {
          const v = record.value as APISIXType['StreamRoute'];
          return v.server_port ?? '-';
        },
      },
      {
        dataIndex: ['value', 'remote_addr'],
        title: 'Remote Address',
        key: 'remote_addr',
        valueType: 'text',
        render: (_, record) => {
          const v = record.value as APISIXType['StreamRoute'];
          return v.remote_addr || '-';
        },
      },
      {
        dataIndex: ['value', 'sni'],
        title: 'SNI',
        key: 'sni',
        valueType: 'text',
        ellipsis: { showTitle: false },
        render: (_, record) => {
          const v = record.value as APISIXType['StreamRoute'];
          return v.sni ? <TableEllipsisText value={v.sni} code /> : '-';
        },
      },
      {
        dataIndex: ['value', 'upstream_id'],
        title: 'Upstream',
        key: 'upstream_id',
        render: (_, record) => {
          const v = record.value as APISIXType['StreamRoute'];
          return v.upstream_id || (v.upstream ? 'Inline' : '-');
        },
      },
      {
        dataIndex: ['value', 'plugins'],
        title: 'Plugins',
        key: 'plugins',
        width: 96,
        filters: pluginFilterOptions,
        onFilter: (value, record) => hasPluginName(record.value.plugins, value),
        render: (_, record) => renderPluginCount(record.value.plugins),
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
        valueType: 'dateTime',
        defaultSortOrder: 'ascend',
        sorter: unixFieldSorter('create_time'),
        renderText: renderUnixDateTime,
      },
      {
        dataIndex: ['value', 'update_time'],
        title: 'Updated At',
        key: 'update_time',
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
        resourceName="Stream Routes"
        query={params.q ?? params.name ?? params.uri ?? ''}
        label={params.label ?? ''}
        onClearFilters={() => setParams({ q: undefined, name: undefined, uri: undefined, label: undefined, page: 1 })}
        selectionActions={
          <BulkDeleteBar
            {...bulkBarProps}
            resourceName="Stream Route"
            apiBase={API_STREAM_ROUTES}
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
          persistenceKey: 'table-v3:stream-routes',
          persistenceType: 'localStorage',
        }}
        dateFormatter="string"
        headerTitle={false}
        pagination={pagination}
        cardProps={{ styles: { body: { padding: 0 } } }}
        scroll={{ x: 'max-content' }}
        expandable={{
          expandedRowRender: (record) => <StreamRouteExpandedRow route={record.value as APISIXType['StreamRoute']} />,
          rowExpandable: () => true,
        }}
        toolBarRender={() => [
          <SearchInput key="search" defaultValue={params.q ?? params.name ?? ''} placeholder="Search stream routes..." onSearch={(q) => setParams({ q, name: undefined, page: 1 })} />,
          <LabelSearchInput key="label" defaultValue={params.label ?? ''} onSearch={(label) => setParams({ label, page: 1 })} />,
          <ResourceSortSelect
            key="sort"
            sortBy={sortBy}
            sortOrder={sortOrder}
            fields={[
              { label: 'ID', value: 'id' },
              { label: 'Server Address', value: 'server_addr' },
              { label: 'Server Port', value: 'server_port' },
              { label: 'SNI', value: 'sni' },
            ]}
            onChange={setSort}
          />,
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

function StreamRouteComponent() {

  return (
    <>
      <PageHeader
        title="Stream Routes"
        desc="Manage TCP and UDP traffic routing through APISIX."
        extra={<ToAddPageBtn label="Add Stream Route" to="/stream_routes/add" />}
      />
      <StreamRouteList
        routeKey="/stream_routes/"
        detailLink={(record) => (
          <Link
            to="/stream_routes/detail/$id"
            params={{ id: record.value.id }}
            className={idClasses.id}
          >
            {record.value.id}
          </Link>
        )}
      />
    </>
  );
}

export const Route = createFileRoute('/stream_routes/')({
  component: StreamRouteComponent,
  errorComponent: StreamRoutesErrorComponent,
  validateSearch: pageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    queryClient.ensureQueryData(getStreamRouteListQueryOptions(deps)),
});
