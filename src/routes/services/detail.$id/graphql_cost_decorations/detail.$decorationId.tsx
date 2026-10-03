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
import { Alert, Skeleton } from 'antd';

import { graphqlCostDecorationsApi } from '@/apis/graphql_cost_decorations';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { GraphqlCostDecorationEditor } from '@/components/form-slice/GraphqlCostDecorationEditor';
import PageHeader from '@/components/page/PageHeader';
import { req } from '@/config/req';
import type { GraphqlCostDecorationType } from '@/types/schema/apisix/graphql_cost_decorations';
import type { APISIXDetailResponse } from '@/types/schema/apisix/type';

function RouteComponent() {
  const { id, decorationId } = useParams({ from: '/services/detail/$id/graphql_cost_decorations/detail/$decorationId' });
  const { data, isLoading, error } = useQuery({
    queryKey: ['graphql_cost_decoration', id, decorationId],
    queryFn: () => req.get<APISIXDetailResponse<GraphqlCostDecorationType>>(`${graphqlCostDecorationsApi(id)}/${encodeURIComponent(decorationId)}`).then((response) => response.data),
  });
  return <>
    <PageHeader showBackBtn title="GraphQL Cost Decoration" desc={decorationId}
      extra={<Link to="/services/detail/$id/graphql_cost_decorations" params={{ id }}>All Cost Decorations</Link>} />
    {isLoading && <Skeleton active />}
    {error && <Alert type="error" message="Could not load cost decoration" description={error.message} />}
    {data && <FormTOCBox><GraphqlCostDecorationEditor key={`${id}/${decorationId}`} serviceId={id} initialData={data.value} /></FormTOCBox>}
  </>;
}

export const Route = createFileRoute('/services/detail/$id/graphql_cost_decorations/detail/$decorationId')({ component: RouteComponent });
