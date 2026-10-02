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

import { getGlobalRuleListQueryOptions, useGlobalRuleList } from '@/apis/hooks';
import { CopyableIDLink } from '@/components/CopyableID';
import idClasses from '@/components/CopyableID.module.css';
import { BulkDeleteBar } from '@/components/page/BulkDeleteBar';
import { GlobalRuleExpandedRow } from '@/components/page/ExpandedRowComponents';
import PageHeader from '@/components/page/PageHeader';
import { RawDrawer } from '@/components/page/RawDrawer';
import { ResourceSortSelect } from '@/components/page/ResourceSortSelect';
import { ResourceTable } from '@/components/page/ResourceTable';
import { SearchInput } from '@/components/page/SearchInput';
import { ToAddPageBtn } from '@/components/page/ToAddPageBtn';
import { AntdConfigProvider } from '@/config/antdConfigProvider';
import { API_GLOBAL_RULES } from '@/config/constant';
import { queryClient } from '@/config/global';
import type { APISIXType } from '@/types/schema/apisix';
import { pageSearchSchema } from '@/types/schema/pageSearch';
import { getPluginFilterOptions, hasPluginName, renderPluginCount, renderUnixDateTime, unixFieldSorter } from '@/utils/columns';
import { useBulkActions } from '@/utils/useBulkActions';

function GlobalRulesList() {
  const { data, isFetching, refetch, pagination, params, setParams, sortBy, sortOrder, setSort } = useGlobalRuleList();
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
    ProColumns<APISIXType['RespGlobalRuleItem']>[]
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
            onClick={() => setRawTarget({ api: `${API_GLOBAL_RULES}/${record.value.id}`, title: `Global Rule: ${record.value.id}`, data: record.value as Record<string, unknown> })}
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
            <Link
              to="/global_rules/detail/$id"
              params={{ id: record.value.id }}
              className={idClasses.id}
            >
              {record.value.id}
            </Link>
          </CopyableIDLink>
        ),
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
        resourceName="Global Rules"
        query={params.q ?? params.name ?? params.uri ?? ''}
        label={params.label ?? ''}
        onClearFilters={() => setParams({ q: undefined, name: undefined, uri: undefined, label: undefined, page: 1 })}
        selectionActions={
          <BulkDeleteBar
            {...bulkBarProps}
            resourceName="Global Rule"
            apiBase={API_GLOBAL_RULES}
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
          persistenceKey: 'table-v3:global-rules',
          persistenceType: 'localStorage',
        }}
        dateFormatter="string"
        headerTitle={false}
        pagination={pagination}
        cardProps={{ styles: { body: { padding: 0 } } }}
        scroll={{ x: 'max-content' }}
        expandable={{
          expandedRowRender: (record) => <GlobalRuleExpandedRow rule={record.value} />,
          rowExpandable: () => true,
        }}
        toolBarRender={() => [
          <SearchInput key="search" defaultValue={params.q ?? ''} placeholder="Search global rules..." onSearch={(q) => setParams({ q, page: 1 })} />,
          <ResourceSortSelect
            key="sort"
            sortBy={sortBy}
            sortOrder={sortOrder}
            fields={[{ label: 'ID', value: 'id' }]}
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
        title="Global Rules"
        desc="Apply plugin behavior globally across gateway traffic."
        extra={<ToAddPageBtn label="Add Global Rule" to="/global_rules/add" />}
      />
      <GlobalRulesList />
    </>
  );
}

export const Route = createFileRoute('/global_rules/')({
  component: RouteComponent,
  validateSearch: pageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    queryClient.ensureQueryData(getGlobalRuleListQueryOptions(deps)),
});
