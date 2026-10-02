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
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { useMemo } from 'react';

import { getRouteListReq, getRouteReq } from '@/apis/routes';
import { getUpstreamListReq, getUpstreamReq } from '@/apis/upstreams';
import { PAGE_SIZE_MAX } from '@/config/constant';
import { req } from '@/config/req';
import type {
  APISIXDetailResponse,
  APISIXListResponse,
} from '@/types/schema/apisix/type';
import { type PageSearchType } from '@/types/schema/pageSearch';
import { useSearchParams } from '@/utils/useSearchParams';
import {
  type ListPageKeys,
  useTablePagination,
} from '@/utils/useTablePagination';

import {
  getConsumerGroupListReq,
  getConsumerGroupReq,
} from './consumer_groups';
import { getConsumerListReq, getConsumerReq } from './consumers';
import { getCredentialListReq, getCredentialReq } from './credentials';
import { getGlobalRuleListReq, getGlobalRuleReq } from './global_rules';
import { getPluginConfigListReq, getPluginConfigReq } from './plugin_configs';
import { getProtoListReq, getProtoReq } from './protos';
import { getSecretListReq, getSecretReq } from './secrets';
import { getServiceListReq, getServiceReq } from './services';
import { getSSLListReq, getSSLReq } from './ssls';
import { getStreamRouteListReq, getStreamRouteReq } from './stream_routes';

const SORT_KEY_PREFIX = 'table:sort:';
const DEFAULT_SORT = {
  sort_by: 'create_time',
  sort_order: 'asc' as const,
};

const readSavedSort = (key: string) => {
  try {
    const raw = localStorage.getItem(`${SORT_KEY_PREFIX}${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { sort_by?: string; sort_order?: 'asc' | 'desc' };
    if (!parsed.sort_by || !parsed.sort_order) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
};

const saveSort = (key: string, next: { sort_by: string; sort_order: 'asc' | 'desc' }) => {
  try {
    localStorage.setItem(`${SORT_KEY_PREFIX}${key}`, JSON.stringify(next));
  } catch {
    // ignore
  }
};

const SEARCHABLE_LIST_FIELDS = [
  'id',
  'username',
  'name',
  'desc',
  'sni',
  'snis',
  'uri',
  'uris',
  'host',
  'hosts',
  'service_id',
  'upstream_id',
  'plugin_config_id',
  'manager',
] as const;

const normalizeSearch = (value: unknown) => String(value ?? '').trim().toLowerCase();

const appendSearchValue = (values: string[], value: unknown) => {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item) => appendSearchValue(values, item));
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      values.push(key);
      appendSearchValue(values, item);
    });
    return;
  }
  values.push(String(value));
};

const listItemMatchesQuery = <R,>(item: R, query: string) => {
  const record = item as { key?: unknown; value?: Record<string, unknown> };
  const values: string[] = [];
  appendSearchValue(values, record.key);

  const resource = record.value ?? {};
  SEARCHABLE_LIST_FIELDS.forEach((field) => appendSearchValue(values, resource[field]));
  appendSearchValue(values, resource.labels);

  const haystack = values.join(' ').toLowerCase();
  return haystack.includes(query);
};

const stripClientListParams = <P extends PageSearchType>(props: P): P => {
  const rest = { ...props };
  delete rest.q;
  return rest;
};

const fetchClientFilteredList = async <P extends PageSearchType, R>(
  listReq: (req: AxiosInstance, props: P) => Promise<APISIXListResponse<R>>,
  props: P,
  query: string
) => {
  const baseParams = stripClientListParams(props);
  const first = await listReq(req, {
    ...baseParams,
    page: 1,
    page_size: PAGE_SIZE_MAX,
  } as P);
  const all = [...first.list];
  const totalPages = Math.ceil((first.total ?? 0) / PAGE_SIZE_MAX);

  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        listReq(req, {
          ...baseParams,
          page: index + 2,
          page_size: PAGE_SIZE_MAX,
        } as P)
      )
    );
    rest.forEach((page) => all.push(...page.list));
  }

  const filtered = all.filter((item) => listItemMatchesQuery(item, query));
  return {
    ...first,
    total: filtered.length,
    list: filtered,
  };
};

const genDetailQueryOptions =
  <T extends unknown[], R>(
    key: string,
    getDetailReq: (
      req: AxiosInstance,
      ...args: T
    ) => Promise<APISIXDetailResponse<R>>
  ) =>
  (...args: T) => {
    return queryOptions({
      queryKey: [key, ...args],
      queryFn: () => getDetailReq(req, ...args),
    });
  };
/** simple factory func for list query options which support extends PageSearchType */
const genListQueryOptions =
  <P extends PageSearchType, R>(
    key: string,
    listReq: (req: AxiosInstance, props: P) => Promise<APISIXListResponse<R>>
  ) =>
  (props: P) => {
    return queryOptions({
      queryKey: [key, props],
      queryFn: () => {
        const query = normalizeSearch(props.q);
        if (query) return fetchClientFilteredList(listReq, props, query);
        return listReq(req, stripClientListParams(props));
      },
    });
  };

/** simple hook factory func for list hooks which support extends PageSearchType */
export const genUseList = <
  T extends ListPageKeys,
  U extends ListPageKeys,
  P extends PageSearchType,
  R
>(
  routeKey: T,
  listQueryOptions: ReturnType<typeof genListQueryOptions<P, R>>
) => {
  return (replaceKey?: U, defaultParams?: Partial<P>) => {
    const key = replaceKey || routeKey;
    const { params, setParams } = useSearchParams<T | U, P>(key);
    const savedSort = useMemo(() => readSavedSort(key), [key]);

    const listQuery = useSuspenseQuery(
      listQueryOptions({ ...defaultParams, ...params })
    );
    const { data, isFetching, isLoading, refetch } = listQuery;
    const sortBy = (params as PageSearchType).sort_by
      || (defaultParams as PageSearchType | undefined)?.sort_by
      || savedSort?.sort_by
      || DEFAULT_SORT.sort_by;
    const sortOrder = (params as PageSearchType).sort_order
      || (defaultParams as PageSearchType | undefined)?.sort_order
      || savedSort?.sort_order
      || DEFAULT_SORT.sort_order;

    const sortedData = useMemo(() => {
      if (!Array.isArray(data?.list)) return data;
      const list = [...data.list];
      list.sort((a, b) => {
        const aVal = (a as { value?: Record<string, unknown> })?.value?.[sortBy];
        const bVal = (b as { value?: Record<string, unknown> })?.value?.[sortBy];
        const aNum = Number(aVal ?? 0);
        const bNum = Number(bVal ?? 0);

        const base = Number.isNaN(aNum) || Number.isNaN(bNum)
          ? String(aVal ?? '').localeCompare(String(bVal ?? ''), undefined, { numeric: true, sensitivity: 'base' })
          : aNum - bNum;

        return sortOrder === 'desc' ? -base : base;
      });
      return { ...data, list };
    }, [data, sortBy, sortOrder]);

    const setSort = (next: { sort_by: string; sort_order: 'asc' | 'desc' }) =>
      {
        saveSort(key, next);
        return setParams({ ...next, page: 1 } as Partial<P>);
      };

    const opts = { data: sortedData, setParams, params };
    const pagination = useTablePagination(opts);
    return {
      data: sortedData,
      isFetching,
      isLoading,
      refetch,
      pagination,
      params,
      setParams,
      sortBy,
      sortOrder,
      setSort,
    };

  };
};

export type UseListReturn<
  T extends ListPageKeys,
  U extends ListPageKeys,
  P extends PageSearchType,
  R
> = ReturnType<ReturnType<typeof genUseList<T, U, P, R>>>;

export const getUpstreamQueryOptions = genDetailQueryOptions(
  'upstream',
  getUpstreamReq
);
export const getUpstreamListQueryOptions = genListQueryOptions(
  'upstreams',
  getUpstreamListReq
);
export const useUpstreamList = genUseList(
  '/upstreams/',
  getUpstreamListQueryOptions
);

export const getRouteQueryOptions = genDetailQueryOptions('route', getRouteReq);
export const getRouteListQueryOptions = genListQueryOptions(
  'routes',
  getRouteListReq
);
export const useRouteList = genUseList('/routes/', getRouteListQueryOptions);

export const getConsumerGroupQueryOptions = genDetailQueryOptions(
  'consumer_group',
  getConsumerGroupReq
);
export const getConsumerGroupListQueryOptions = genListQueryOptions(
  'consumer_groups',
  getConsumerGroupListReq
);
export const useConsumerGroupList = genUseList(
  '/consumer_groups/',
  getConsumerGroupListQueryOptions
);

export const getStreamRouteQueryOptions = genDetailQueryOptions(
  'stream_route',
  getStreamRouteReq
);
export const getStreamRouteListQueryOptions = genListQueryOptions(
  'stream_routes',
  getStreamRouteListReq
);
export const useStreamRouteList = genUseList(
  '/stream_routes/',
  getStreamRouteListQueryOptions
);

export const getServiceQueryOptions = genDetailQueryOptions(
  'service',
  getServiceReq
);
export const getServiceListQueryOptions = genListQueryOptions(
  'services',
  getServiceListReq
);
export const useServiceList = genUseList(
  '/services/',
  getServiceListQueryOptions
);

export const getGlobalRuleQueryOptions = genDetailQueryOptions(
  'global_rule',
  getGlobalRuleReq
);
export const getGlobalRuleListQueryOptions = genListQueryOptions(
  'global_rules',
  getGlobalRuleListReq
);
export const useGlobalRuleList = genUseList(
  '/global_rules/',
  getGlobalRuleListQueryOptions
);

export const getPluginConfigQueryOptions = genDetailQueryOptions(
  'plugin_config',
  getPluginConfigReq
);
export const getPluginConfigListQueryOptions = genListQueryOptions(
  'plugin_configs',
  getPluginConfigListReq
);
export const usePluginConfigList = genUseList(
  '/plugin_configs/',
  getPluginConfigListQueryOptions
);

export const getSSLQueryOptions = genDetailQueryOptions('ssl', getSSLReq);
export const getSSLListQueryOptions = genListQueryOptions('ssls', getSSLListReq);
export const useSSLList = genUseList('/ssls/', getSSLListQueryOptions);

export const getConsumerQueryOptions = genDetailQueryOptions(
  'consumer',
  getConsumerReq
);
export const getConsumerListQueryOptions = genListQueryOptions(
  'consumers',
  getConsumerListReq
);
export const useConsumerList = genUseList(
  '/consumers/',
  getConsumerListQueryOptions
);

export const getCredentialQueryOptions = genDetailQueryOptions(
  'credential',
  getCredentialReq
);
export const getCredentialListQueryOptions = (username: string) => {
  return queryOptions({
    queryKey: ['credentials', username],
    queryFn: () => getCredentialListReq(req, { username }),
  });
};
export const useCredentialsList = (username: string) => {
  const credentialQuery = useSuspenseQuery(
    getCredentialListQueryOptions(username)
  );
  const { data, isFetching, isLoading, refetch } = credentialQuery;
  return { data, isFetching, isLoading, refetch };
};

export const getProtoQueryOptions = genDetailQueryOptions('proto', getProtoReq);
export const getProtoListQueryOptions = genListQueryOptions('protos', getProtoListReq);
export const useProtoList = genUseList('/protos/', getProtoListQueryOptions);

export const getSecretQueryOptions = genDetailQueryOptions(
  'secret',
  getSecretReq
);
export const getSecretListQueryOptions = genListQueryOptions(
  'secrets',
  getSecretListReq
);
export const useSecretList = genUseList('/secrets/', getSecretListQueryOptions);
