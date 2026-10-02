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
import { Button, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';

import { getSSLListQueryOptions, useSSLList } from '@/apis/hooks';
import { CopyableID } from '@/components/CopyableID';
import { LabelsDisplay } from '@/components/LabelsDisplay';
import { BulkDeleteBar } from '@/components/page/BulkDeleteBar';
import { SSLExpandedRow } from '@/components/page/ExpandedRowComponents';
import { LabelSearchInput } from '@/components/page/LabelSearchInput';
import PageHeader from '@/components/page/PageHeader';
import { RawDrawer } from '@/components/page/RawDrawer';
import { ResourceSortSelect } from '@/components/page/ResourceSortSelect';
import { ResourceTable } from '@/components/page/ResourceTable';
import { SearchInput } from '@/components/page/SearchInput';
import { ToAddPageBtn } from '@/components/page/ToAddPageBtn';
import { StatusSwitch } from '@/components/StatusTag';
import { TableEllipsisText } from '@/components/TableEllipsisText';
import { AntdConfigProvider } from '@/config/antdConfigProvider';
import { API_SSLS } from '@/config/constant';
import { queryClient } from '@/config/global';
import type { APISIXType } from '@/types/schema/apisix';
import { pageSearchSchema } from '@/types/schema/pageSearch';
import { renderUnixDateTime, unixFieldSorter } from '@/utils/columns';
import { useBulkActions } from '@/utils/useBulkActions';

function RouteComponent() {
  const { data, isFetching, refetch, pagination, params, setParams, sortBy, sortOrder, setSort } = useSSLList();
  const { rowSelection, bulkBarProps } = useBulkActions(
    refetch,
    data?.list?.map((record) => record.value.id)
  );
  const [rawTarget, setRawTarget] = useState<{ api: string; title: string; data?: Record<string, unknown> } | null>(null);

  const columns = useMemo<ProColumns<APISIXType['RespSSLItem']>[]>(() => {
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
            onClick={() => setRawTarget({ api: `${API_SSLS}/${record.value.id}`, title: `SSL: ${record.value.id}`, data: record.value as Record<string, unknown> })}
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
        dataIndex: ['value', 'sni'],
        title: 'SNI',
        key: 'sni',
        ellipsis: { showTitle: false },
        render: (_, record) => {
          const sni = record.value.sni;
          const snis = record.value.snis;
          const display = sni || (snis && snis.length > 0 ? snis.join(', ') : '-');
          return (
            <Link to="/ssls/detail/$id" params={{ id: record.value.id }}>
              <TableEllipsisText value={display} strong />
            </Link>
          );
        },
      },
      {
        dataIndex: ['value', 'type'],
        title: 'Type',
        key: 'type',
        valueType: 'text',
        render: (_, record) => record.value.type || '-',
      },
      {
        dataIndex: ['value', 'status'],
        title: 'Status',
        key: 'status',
        filters: [
          { text: 'Enabled', value: 1 },
          { text: 'Disabled', value: 0 },
        ],
        onFilter: (value, record) => record.value.status === value,
        render: (_, record) => (
          <StatusSwitch
            status={record.value.status ?? 1}
            api={`${API_SSLS}/${record.value.id}`}
          />
        ),
      },
      {
        dataIndex: ['value', 'validity_end'],
        title: 'Expiry',
        key: 'validity_end',
        render: (_, record) => {
          const end = (record.value as Record<string, unknown>)['validity_end'] as number | undefined;
          if (!end) return '-';
          const endMs = Number(end) * 1000;
          const now = Date.now();
          const daysLeft = Math.ceil((endMs - now) / (1000 * 60 * 60 * 24));
          const dateStr = dayjs.unix(Number(end)).format('YYYY-MM-DD HH:mm:ss');
          if (endMs < now) {
            return (
              <Space>
                <Tag color="error">Expired</Tag>
                <span>{dateStr}</span>
              </Space>
            );
          }
          if (daysLeft <= 30) {
            return (
              <Space>
                <Tag color="warning">Expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}</Tag>
                <span>{dateStr}</span>
              </Space>
            );
          }
          return (
            <Space>
              <Tag color="success">Valid ({daysLeft} days)</Tag>
              <span>{dateStr}</span>
            </Space>
          );
        },
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
  }, []);

  return (
    <>
      <PageHeader
        title="SSLs"
        desc="Manage TLS certificates and SNI bindings for secure traffic."
        extra={<ToAddPageBtn label="Add SSL" to="/ssls/add" />}
      />
      <AntdConfigProvider>
        <ResourceTable
        resourceName="SSLs"
        query={params.q ?? params.name ?? params.uri ?? ''}
        label={params.label ?? ''}
        onClearFilters={() => setParams({ q: undefined, name: undefined, uri: undefined, label: undefined, page: 1 })}
        selectionActions={
          <BulkDeleteBar
              {...bulkBarProps}
              resourceName="SSL"
              apiBase={API_SSLS}
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
            persistenceKey: 'table-v3:ssls',
            persistenceType: 'localStorage',
          }}
          dateFormatter="string"
          headerTitle={false}
          pagination={pagination}
          cardProps={{ styles: { body: { padding: 0 } } }}
          scroll={{ x: 'max-content' }}
          expandable={{
            expandedRowRender: (record) => <SSLExpandedRow ssl={record.value as Record<string, unknown>} />,
            rowExpandable: () => true,
          }}
          toolBarRender={() => [
            <SearchInput key="search" defaultValue={params.q ?? params.name ?? ''} placeholder="Search SSLs..." onSearch={(q) => setParams({ q, name: undefined, page: 1 })} />,
            <LabelSearchInput key="label" defaultValue={params.label ?? ''} onSearch={(label) => setParams({ label, page: 1 })} />,
            <ResourceSortSelect
              key="sort"
              sortBy={sortBy}
              sortOrder={sortOrder}
              fields={[
                { label: 'ID', value: 'id' },
                { label: 'SNI', value: 'sni' },
                { label: 'Expiry', value: 'validity_end' },
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
    </>
  );
}

export const Route = createFileRoute('/ssls/')({
  component: RouteComponent,
  validateSearch: pageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    queryClient.ensureQueryData(getSSLListQueryOptions(deps)),
});
