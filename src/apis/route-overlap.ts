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
import { fetchAllResources } from '@/apis/fetchAll';
import { isSavedRoute, type SavedRoute } from '@/utils/routeOverlap';

export async function readRoutesForOverlap(signal?: AbortSignal): Promise<SavedRoute[]> {
  let total: number | undefined;
  const routes = await fetchAllResources<SavedRoute>(async (client, params) => {
    const { data } = await client.get('/routes', { params, signal, timeout: 15_000 });
    if (!Number.isSafeInteger(data?.total) || data.total < 0 || !Array.isArray(data.list) ||
        data.list.some((row: { value?: unknown }) => !isSavedRoute(row?.value)) || (total !== undefined && total !== data.total))
      throw new Error('The Route list is incomplete or invalid. Refresh the comparison.');
    total = data.total;
    return data;
  });
  if (routes.length !== total || new Set(routes.map((route) => String(route.id))).size !== routes.length)
    throw new Error('The Route list changed while reading. Refresh the comparison.');
  return routes;
}
