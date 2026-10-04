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

import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Alert, Button, Space } from 'antd';

import { getGraphqlCostDecorations, graphqlCostDecorationsApi } from '@/apis/graphql_cost_decorations';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { ResourceTable } from '@/components/page/ResourceTable';
import { req } from '@/config/req';
import type { GraphqlCostDecorationType } from '@/types/schema/apisix/graphql_cost_decorations';

function RouteComponent() {
  const { id } = useParams({ from: '/services/detail/$id/graphql_cost_decorations/' });
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['graphql_cost_decorations', id],
    queryFn: () => getGraphqlCostDecorations(req, id),
  });
  return <>
    <PageHeader title="GraphQL Cost Decorations" extra={<Link to="/services/detail/$id/graphql_cost_decorations/add" params={{ id }}><Button type="primary">Add Decoration</Button></Link>} />
    <Alert type="info" showIcon title="APISIX 3.19+ query cost controls" style={{ marginBottom: 16 }}
      description="Configure graphql-limit-count on this Service with cost_strategy complexity or node_quantifier to use these weights. The default depth strategy does not use decorations. Cost = child cost × multiplier + own cost. Configure max_cost in the plugin to reject expensive queries." />
    {error && <Alert type="error" showIcon title="Could not load cost decorations" description={error.message} action={<Button onClick={() => { void refetch(); }}>Retry</Button>} />}
    {!error && <ResourceTable<{ value: GraphqlCostDecorationType }> resourceName="Cost decorations" search={false} toolBarRender={false} headerTitle={false}
      options={{ reload: () => { void refetch(); } }} columnsState={{ persistenceKey: 'graphql-cost-decorations' }}
      cardProps={{ styles: { body: { padding: 0 } } }} scroll={{ x: 'max-content' }}
      dataSource={data?.list ?? []} loading={isFetching} rowKey={(row) => String(row.value.id)} pagination={false}
      columns={[
        { title: 'ID', key: 'id', render: (_, row) => <Link to="/services/detail/$id/graphql_cost_decorations/detail/$decorationId" params={{ id, decorationId: String(row.value.id) }}>{row.value.id}</Link> },
        { title: 'Field Path', key: 'field_path', dataIndex: ['value', 'field_path'] },
        { title: 'Add Value', key: 'add_value', render: (_, row) => row.value.add_value ?? 1 },
        { title: 'Multiply Value', key: 'mul_value', render: (_, row) => row.value.mul_value ?? 1 },
        { title: 'Multiply Arguments', key: 'mul_arguments', render: (_, row) => row.value.mul_arguments?.join(', ') || '-' },
        { title: 'Actions', key: 'option', render: (_, row) => <Space><DeleteResourceBtn name="GraphQL cost decoration" target={String(row.value.id)} api={`${graphqlCostDecorationsApi(id)}/${encodeURIComponent(String(row.value.id))}`} onSuccess={async () => { await refetch({ throwOnError: true }); }} /></Space> },
      ]} />}
  </>;
}

export const Route = createFileRoute('/services/detail/$id/graphql_cost_decorations/')({ component: RouteComponent });
