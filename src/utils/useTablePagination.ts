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

import type { TablePaginationConfig } from 'antd';
import { useCallback, useMemo } from 'react';

import type { FileRoutesByTo } from '@/routeTree.gen';
import type { APISIXListResponse } from '@/types/schema/apisix/type';
import {
  pageSearchSchema,
  type PageSearchType,
} from '@/types/schema/pageSearch';

import type { UseSearchParams } from './useSearchParams';

const PAGE_SIZE_KEY = 'table:pageSize';
const PAGE_SIZE_OPTIONS = ['10', '20', '50', '100'];

const getSavedPageSize = (): number => {
  try {
    const saved = localStorage.getItem(PAGE_SIZE_KEY);
    const size = Number(saved);
    if (Number.isInteger(size) && size >= 10 && size <= 500) return size;
  } catch {
    // ignore
  }
  return 10;
};

const savePageSize = (size: number) => {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(size));
  } catch {
    // ignore
  }
};

export type ListPageKeys = `${keyof FilterKeys<FileRoutesByTo, 's'>}/`;
type Props<T, P extends PageSearchType> = {
  data: APISIXListResponse<T>;
  /** if params is from useSearchParams, refetch is not needed */
  refetch?: () => void;
} & Pick<UseSearchParams<ListPageKeys, P>, 'params' | 'setParams'>;

export const useTablePagination = <T, P extends PageSearchType>(
  props: Props<T, P>
) => {
  const { data, refetch, setParams } = props;
  const savedPageSize = useMemo(() => getSavedPageSize(), []);
  const params = useMemo(
    () => pageSearchSchema.parse(props.params),
    [props.params]
  );
  const page = params.page;
  const page_size = params.page_size || savedPageSize;

  const onChange: TablePaginationConfig['onChange'] = useCallback(
    (page: number, nextSize: number) => {
      savePageSize(nextSize);
      setParams({ page: nextSize === page_size ? page : 1, page_size: nextSize } as P);
      refetch?.();
    },
    [page_size, refetch, setParams]
  );

  const pagination = {
    current: page,
    pageSize: page_size,
    total: data.total ?? 0,
    showSizeChanger: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    showTotal: (total: number, range: [number, number]) => total === 0 ? '0 items' : `${range[0]}–${range[1]} of ${total} items`,
    onChange: onChange,
  } as TablePaginationConfig;
  return pagination;
};
