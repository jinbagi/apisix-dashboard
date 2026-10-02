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

import type { AxiosInstance, AxiosResponse } from 'axios';
import axios from 'axios';

import { API_SERVICES, SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import type { GraphqlCostDecorationType } from '@/types/schema/apisix/graphql_cost_decorations';
import type { APISIXDetailResponse, APISIXListResponse } from '@/types/schema/apisix/type';
import { stripSystemReadonlyFields } from '@/utils/apisixEditable';

import { createResourceReq } from './utils';

export const graphqlCostDecorationsApi = (serviceId: string) =>
  `${API_SERVICES}/${encodeURIComponent(serviceId)}/graphql_cost_decorations`;

export const prepareGraphqlCostDecoration = (data: Record<string, unknown>) => {
  const payload = stripSystemReadonlyFields(data);
  delete payload.service_id;
  return payload;
};

export const getGraphqlCostDecorations = async (req: AxiosInstance, serviceId: string) => {
  try {
    const response = await req.get<APISIXListResponse<GraphqlCostDecorationType>>(
      graphqlCostDecorationsApi(serviceId),
      { headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] } }
    );
    return response.data;
  } catch (error) {
    // APISIX returns 404 when this service has no decorations.
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return { list: [], total: 0 };
    }
    throw error;
  }
};

export const saveGraphqlCostDecoration = (req: AxiosInstance, serviceId: string, data: GraphqlCostDecorationType) =>
  createResourceReq<AxiosResponse<APISIXDetailResponse<GraphqlCostDecorationType>>>(
    req, graphqlCostDecorationsApi(serviceId), { ...data, id: data.id === undefined ? undefined : String(data.id) },
    { sanitize: prepareGraphqlCostDecoration }
  );
