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
import { queryClient } from '@/config/global';

// Refresh cached lists and reference options after a verified create or save,
// including inactive queries, before reporting success or navigating. This
// keeps created resources and renamed labels available within staleTime.
export const refreshResourceCaches = async (resourceKey: string | readonly string[], resourceApi: string) => {
  const queryKeys = [
    typeof resourceKey === 'string' ? [resourceKey] : resourceKey,
    ['resource-select', resourceApi],
  ];
  // A first fetch with no cached data can otherwise reuse its pre-save promise
  // and publish an old snapshot after invalidation. Discard it before refetching.
  await Promise.all(queryKeys.map((queryKey) => queryClient.cancelQueries({ queryKey })));
  await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey, refetchType: 'all' })));
};
