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
import { Button, Select, type SelectProps, Space, Typography } from 'antd';
import { type ReactNode, useMemo, useState } from 'react';
import {
  type FieldValues,
  useController,
  type UseControllerProps,
} from 'react-hook-form';

import { PAGE_SIZE_MAX } from '@/config/constant';
import { req } from '@/config/req';

import { InputWrapper } from './InputWrapper';
import { genControllerProps, getAccessibleFieldLabel } from './util';

type ResourceSelectProps<T extends FieldValues> = UseControllerProps<T> &
  Omit<SelectProps, 'value' | 'defaultValue' | 'options'> & {
    label?: ReactNode;
    description?: ReactNode;
    /** APISIX Admin API path, e.g., '/services' */
    resourceApi: string;
    /** Resource type label for display */
    resourceLabel: string;
  };

export const ResourceSelect = <T extends FieldValues>(
  props: ResourceSelectProps<T>
) => {
  const {
    controllerProps,
    restProps: { label, description, resourceApi, resourceLabel, ...restProps },
  } = genControllerProps(props, '');
  const {
    field: { value, onChange: fOnChange, ...restField },
    fieldState,
  } = useController<T>({ ...controllerProps, disabled: undefined });
  const [open, setOpen] = useState(false);
  const fieldLabel = label ?? `${resourceLabel} ID`;

  const {
    data: options,
    isError: optionsError,
    isFetching: optionsFetching,
    refetch: refetchOptions,
  } = useQuery({
    queryKey: ['resource-select', resourceApi],
    queryFn: async () => {
      const pageSize = PAGE_SIZE_MAX;
      const maxPages = 20;
      const resourceMap = new Map<string, { id: string; name: string }>();

      const normalizeText = (raw: unknown): string => {
        if (typeof raw === 'string') return raw.trim();
        if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
        return '';
      };

      const parseId = (item: { key?: unknown; value?: Record<string, unknown> }) => {
        const directId = normalizeText(item.value?.id);
        if (directId) return directId;

        const usernameId = normalizeText(item.value?.username);
        if (usernameId) return usernameId;

        const key = normalizeText(item.key);
        if (!key) return '';
        const seg = key.split('/').filter(Boolean).at(-1);
        return seg ? normalizeText(seg) : '';
      };

      for (let page = 1; page <= maxPages; page += 1) {
        const res = await req.get(resourceApi, {
          params: {
            page,
            page_size: pageSize,
          },
        });
        const list = res.data?.list;
        if (!Array.isArray(list) || list.length === 0) break;

        list.forEach((item: { key?: unknown; value?: Record<string, unknown> }) => {
          const id = parseId(item);
          if (!id) return;

          const name = normalizeText(item.value?.name) || normalizeText(item.value?.desc);
          resourceMap.set(id, { id, name });
        });

        if (list.length < pageSize) break;
      }
      return Array.from(resourceMap.values()).sort((a, b) =>
        a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
      );

    },
    staleTime: 30_000,
    enabled: open || !!value,
  });

  const selectOptions = useMemo(
    () =>
      (options ?? [])
        .filter((opt) => opt.id.trim() !== '')
        .map((opt) => ({
        value: opt.id,
        searchText: `${opt.id} ${opt.name}`.toLowerCase(),
        label: (
          <span>
            <Typography.Text code style={{ fontSize: 'var(--app-font-size-sm)' }}>{opt.id}</Typography.Text>
            {opt.name && (
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 'var(--app-font-size-sm)' }}>
                {opt.name}
              </Typography.Text>
            )}
          </span>
        ),
      })),
    [options]
  );

  return (
    <InputWrapper
      label={fieldLabel}
      description={description ?? `Select an existing ${resourceLabel} or type an ID`}
      error={fieldState.error?.message}
      status={fieldState.isDirty && !fieldState.error ? 'success' : undefined}
      fieldPath={controllerProps.name}
    >
      <Select
        {...restField}
        {...restProps}
        aria-label={
          restProps['aria-label'] ?? getAccessibleFieldLabel(fieldLabel)
        }
        value={value || undefined}
        onChange={(v) => fOnChange(v || undefined)}
        onOpenChange={setOpen}
        options={selectOptions}
        showSearch
        allowClear
        filterOption={(input, option) => {
          const q = input.toLowerCase().trim();
          if (!q) return true;
          const valueMatch = option?.value?.toString().toLowerCase().includes(q);
          const optionText = ((option as { searchText?: string } | undefined)?.searchText ?? '');
          return !!valueMatch || optionText.includes(q);
        }}
        loading={optionsFetching}
        notFoundContent={
          optionsError ? (
            <Space orientation="vertical" size={4} align="center">
              <Typography.Text type="danger">
                {resourceLabel} options unavailable
              </Typography.Text>
              <Button
                type="link"
                size="small"
                loading={optionsFetching}
                onClick={() => void refetchOptions()}
              >
                Retry
              </Button>
            </Space>
          ) : undefined
        }
        placeholder={`Select ${resourceLabel}...`}
        style={{ width: '100%' }}
      />
    </InputWrapper>
  );
};
