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
import { Select, type SelectProps } from 'antd';
import { isValidElement, type ReactNode, useMemo } from 'react';
import {
  type FieldValues,
  useController,
  type UseControllerProps,
} from 'react-hook-form';

import { InputWrapper } from './InputWrapper';
import { genControllerProps, getAccessibleFieldLabel } from './util';

const normalizeSelectData = (data: unknown): SelectProps['options'] => {
  if (!Array.isArray(data)) return undefined;

  const normalized: NonNullable<SelectProps['options']> = [];

  data.forEach((item) => {
    if (typeof item === 'string' || typeof item === 'number') {
      normalized.push({ label: String(item), value: item });
      return;
    }

    if (!item || typeof item !== 'object' || isValidElement(item)) return;

    const option = item as Record<string, unknown>;
    if (typeof option.group === 'string' && Array.isArray(option.items)) {
      const options = normalizeSelectData(option.items);
      if (options?.length) {
        normalized.push({ label: option.group, options });
      }
      return;
    }

    if ('value' in option) {
      const value = option.value;
      if (typeof value !== 'string' && typeof value !== 'number') return;
      const label =
        typeof option.label === 'string' ||
        typeof option.label === 'number' ||
        isValidElement(option.label)
          ? option.label
          : String(value);
      normalized.push({
        ...option,
        label,
        value,
      });
    }
  });

  return normalized;
};

export type FormItemSelectProps<T extends FieldValues, R> = UseControllerProps<T> &
  Omit<SelectProps, 'value' | 'defaultValue'> & {
    from?: (v: R) => string;
    to?: (v: string) => R;
    label?: ReactNode;
    description?: ReactNode;
    data?: unknown;
    clearable?: boolean;
    searchable?: boolean;
    required?: boolean;
  };

export const FormItemSelect = <T extends FieldValues, R>(
  props: FormItemSelectProps<T, R>
) => {
  const {
    controllerProps,
    restProps: {
      from,
      to,
      label,
      description,
      data,
      clearable = false,
      searchable = false,
      required = false,
      ...restProps
    },
  } = genControllerProps(props);

  const {
    field: { value, onChange: fOnChange, ...restField },
    fieldState,
  } = useController<T>(controllerProps);

  const sanitizedOptions = useMemo(() => {
    const sanitize = (options: SelectProps['options']): SelectProps['options'] => {
      if (!options) return options;
      return options
        .map((opt) => {
          if (!opt) return undefined;
          if ('options' in opt && Array.isArray(opt.options)) {
            const childOptions = sanitize(opt.options);
            if (!childOptions || childOptions.length === 0) return undefined;
            return { ...opt, options: childOptions };
          }
          const rawValue = opt.value;
          const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
          if (value === '' || value === undefined || value === null) return undefined;
          const label = opt.label;
          const isBlankLabel = typeof label === 'string' && label.trim() === '';
          if (isBlankLabel) return undefined;
          return { ...opt, value };
        })
        .filter((opt): opt is NonNullable<typeof opt> => !!opt);
    };

    return sanitize(restProps.options ?? normalizeSelectData(data));
  }, [data, restProps.options]);
  const ariaLabel =
    restProps['aria-label'] ?? getAccessibleFieldLabel(label);

  return (
    <InputWrapper
      label={label}
      description={description}
      error={fieldState.error?.message}
      status={fieldState.isDirty && !fieldState.error ? 'success' : undefined}
      fieldPath={controllerProps.name}
      required={required || !!controllerProps.rules?.required}
    >
      <Select
        value={from ? from(value) : value}
        status={fieldState.error ? 'error' : undefined}
        onChange={(value, option) => {
          const val = to && value ? to(value) : value;
          fOnChange(val);
          restProps?.onChange?.(value, option);
        }}
        allowClear={clearable}
        showSearch={searchable}
        optionFilterProp={searchable ? 'label' : undefined}
        {...restField}
        {...restProps}
        style={{ width: '100%', ...restProps.style }}
        aria-label={ariaLabel}
        options={sanitizedOptions}
      />
    </InputWrapper>
  );
};
