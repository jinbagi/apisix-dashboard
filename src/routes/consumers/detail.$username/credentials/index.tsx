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
import { ProTable } from '@ant-design/pro-components';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Space } from 'antd';
import dayjs from 'dayjs';
import { useMemo } from 'react';

import {
  getCredentialListQueryOptions,
  useCredentialsList,
} from '@/apis/hooks';
import { CopyableIDLink } from '@/components/CopyableID';
import idClasses from '@/components/CopyableID.module.css';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { ToAddPageBtn } from '@/components/page/ToAddPageBtn';
import { AntdConfigProvider } from '@/config/antdConfigProvider';
import { API_CREDENTIALS } from '@/config/constant';
import { queryClient } from '@/config/global';
import type { APISIXType } from '@/types/schema/apisix';
import { getPluginFilterOptions, hasPluginName, renderPluginCount } from '@/utils/columns';

function CredentialsList() {
  const { username } = useParams({
    from: '/consumers/detail/$username/credentials/',
  });
  const { data, isFetching, refetch } = useCredentialsList(username);
  const pluginFilterOptions = useMemo(
    () => getPluginFilterOptions(data?.list),
    [data?.list]
  );

  const columns = useMemo<
    ProColumns<APISIXType['RespCredentialItem']>[]
  >(() => {
    return [
      {
        dataIndex: ['value', 'id'],
        title: 'ID',
        key: 'id',
        valueType: 'text',
        render: (_, record) => (
          <CopyableIDLink id={record.value.id}>
            <Link
              to="/consumers/detail/$username/credentials/detail/$id"
              params={{
                username: username as string,
                id: record.value.id,
              }}
              className={idClasses.id}
            >
              {record.value.id}
            </Link>
          </CopyableIDLink>
        ),
      },
      {
        dataIndex: ['value', 'name'],
        title: 'Name',
        key: 'name',
        render: (_, record) => (
          <Link to="/consumers/detail/$username/credentials/detail/$id" params={{ username, id: record.value.id }}>
            {record.value.name || '-'}
          </Link>
        ),
      },
      {
        dataIndex: ['value', 'desc'],
        title: 'Description',
        key: 'desc',
        valueType: 'text',
      },
      {
        dataIndex: ['value', 'plugins'],
        title: 'Plugin Type',
        key: 'plugins',
        filters: pluginFilterOptions,
        onFilter: (value, record) => hasPluginName(record.value.plugins, value),
        render: (_, record) => renderPluginCount(record.value.plugins),
      },
      {
        dataIndex: ['value', 'update_time'],
        title: 'Updated At',
        key: 'update_time',
        valueType: 'dateTime',
        sorter: true,
        renderText: (text) => {
          if (!text) return '-';
          return dayjs.unix(Number(text)).format('YYYY-MM-DD HH:mm:ss');
        },
      },
      {
        title: 'Actions',
        valueType: 'option',
        key: 'option',
        width: 160,
        render: (_, record) => [
          <Space key="actions">
            <DeleteResourceBtn
              key="delete"
              name="Credential"
              target={record.value.id}
              api={`${API_CREDENTIALS(username)}/${record.value.id}`}
              onSuccess={refetch}
            />
          </Space>,
        ],
      },
    ];
  }, [pluginFilterOptions, refetch, username]);

  return (
    <AntdConfigProvider>
      <ProTable
        columns={columns}
        dataSource={data?.list}
        rowKey={(record) => record.value.id}
        loading={isFetching}
        search={false}
        options={{ density: true, fullScreen: false, reload: () => { void refetch(); }, setting: true }}
        columnsState={{
          persistenceKey: 'table-v2:credentials',
          persistenceType: 'localStorage',
        }}
        dateFormatter="string"
        headerTitle={<Space><span>Credentials</span><ToAddPageBtn label="Add Credential" to="/consumers/detail/$username/credentials/add" params={{ username }} /></Space>}
        pagination={false}
        cardProps={{ styles: { body: { padding: 0 } } }}
        scroll={{ x: 'max-content' }}
        toolBarRender={() => []}
      />
    </AntdConfigProvider>
  );
}

function RouteComponent() {
  return (
    <>
      <PageHeader title="Credentials" />
      <CredentialsList />
    </>
  );
}

export const Route = createFileRoute('/consumers/detail/$username/credentials/')({
  component: RouteComponent,
  loader: ({ params }) =>
    queryClient.ensureQueryData(getCredentialListQueryOptions(params.username)),
});
