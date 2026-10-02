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

import { getConsumerListQueryOptions, useConsumerList } from '@/apis/hooks';
import { CopyableIDLink } from '@/components/CopyableID';
import idClasses from '@/components/CopyableID.module.css';
import { LabelsDisplay } from '@/components/LabelsDisplay';
import { BulkDeleteBar } from '@/components/page/BulkDeleteBar';
import { ConsumerExpandedRow } from '@/components/page/ExpandedRowComponents';
import { LabelSearchInput } from '@/components/page/LabelSearchInput';
import PageHeader from '@/components/page/PageHeader';
import { RawDrawer } from '@/components/page/RawDrawer';
import { ResourceSortSelect } from '@/components/page/ResourceSortSelect';
import { ResourceTable } from '@/components/page/ResourceTable';
import { SearchInput } from '@/components/page/SearchInput';
import { ToAddPageBtn } from '@/components/page/ToAddPageBtn';
import { AntdConfigProvider } from '@/config/antdConfigProvider';
import { API_CONSUMERS } from '@/config/constant';
import { queryClient } from '@/config/global';
import type { APISIXType } from '@/types/schema/apisix';
import { pageSearchSchema } from '@/types/schema/pageSearch';
import { getPluginFilterOptions, hasPluginName, renderPluginCount, renderUnixDateTime, unixFieldSorter } from '@/utils/columns';
import { useBulkActions } from '@/utils/useBulkActions';

function ConsumersList() {
  const { data, isFetching, refetch, pagination, params, setParams, sortBy, sortOrder, setSort } = useConsumerList();
  const { rowSelection, bulkBarProps } = useBulkActions(
    refetch,
    data?.list?.map((record) => record.value.username)
  );
  const [rawTarget, setRawTarget] = useState<{ api: string; title: string; data?: Record<string, unknown> } | null>(null);
  const pluginFilterOptions = useMemo(
    () => getPluginFilterOptions(data?.list),
    [data?.list]
  );

  const columns = useMemo<ProColumns<APISIXType['RespConsumerItem']>[]>(() => {
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
            onClick={() => setRawTarget({ api: `${API_CONSUMERS}/${record.value.username}`, title: `Consumer: ${record.value.username}`, data: record.value as Record<string, unknown> })}
          >
            Raw
          </Button>,
        ],
      },
      {
        dataIndex: ['value', 'username'],
        title: 'Username',
        key: 'username',
        render: (_, record) => (
          <CopyableIDLink id={record.value.username}>
            <Link
              to="/consumers/detail/$username"
              params={{ username: record.value.username }}
              className={idClasses.id}
            >
              {record.value.username}
            </Link>
          </CopyableIDLink>
        ),
      },
      {
        dataIndex: ['value', 'desc'],
        title: 'Description',
        key: 'desc',
        valueType: 'text',
      },
      {
        dataIndex: ['value', 'group_id'],
        title: 'Group',
        key: 'group_id',
        render: (_, record) => {
          const id = record.value.group_id;
          if (!id) return '-';
          return (
            <Link to="/consumer_groups/detail/$id" params={{ id }}>{id}</Link>
          );
        },
      },
      {
        dataIndex: ['value', 'plugins'],
        title: 'Plugins',
        key: 'plugins',
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
  }, [pluginFilterOptions]);

  return (
    <AntdConfigProvider>
      <ResourceTable
        resourceName="Consumers"
        query={params.q ?? params.name ?? params.uri ?? ''}
        label={params.label ?? ''}
        onClearFilters={() => setParams({ q: undefined, name: undefined, uri: undefined, label: undefined, page: 1 })}
        selectionActions={
          <BulkDeleteBar
            {...bulkBarProps}
            resourceName="Consumer"
            apiBase={API_CONSUMERS}
          />
        }
        columns={columns}
        dataSource={data?.list}
        rowKey={(record) => record.value.username}
        loading={isFetching}
        search={false}
        rowSelection={rowSelection}
        options={{ density: true, fullScreen: false, reload: () => { void refetch(); }, setting: true }}
        columnsState={{
          persistenceKey: 'table-v3:consumers',
          persistenceType: 'localStorage',
        }}
        dateFormatter="string"
        headerTitle={false}
        pagination={pagination}
        cardProps={{ styles: { body: { padding: 0 } } }}
        scroll={{ x: 'max-content' }}
        expandable={{
          expandedRowRender: (record) => <ConsumerExpandedRow consumer={record.value} />,
          rowExpandable: () => true,
        }}
        toolBarRender={() => [
          <SearchInput key="search" defaultValue={params.q ?? params.name ?? ''} placeholder="Search consumers..." onSearch={(q) => setParams({ q, name: undefined, page: 1 })} />,
          <LabelSearchInput key="label" defaultValue={params.label ?? ''} onSearch={(label) => setParams({ label, page: 1 })} />,
          <ResourceSortSelect
            key="sort"
            sortBy={sortBy}
            sortOrder={sortOrder}
            fields={[{ label: 'Username', value: 'username' }]}
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
}

function RouteComponent() {
  return (
    <>
      <PageHeader
        title="Consumers"
        desc="Manage API identities, credentials, labels, and consumer-level plugins."
        extra={<ToAddPageBtn label="Add Consumer" to="/consumers/add" />}
      />
      <ConsumersList />
    </>
  );
}

export const Route = createFileRoute('/consumers/')({
  component: RouteComponent,
  validateSearch: pageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    queryClient.ensureQueryData(getConsumerListQueryOptions(deps)),
});
