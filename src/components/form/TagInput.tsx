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
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  type FieldValues,
  useController,
  type UseControllerProps,
} from 'react-hook-form';

import { InputWrapper } from './InputWrapper';
import { genControllerProps, getAccessibleFieldLabel } from './util';

export type FormItemTagsInputProps<
  T extends FieldValues,
  R
> = UseControllerProps<T> &
  Omit<SelectProps, 'value' | 'defaultValue' | 'mode'> & {
    from?: (v: R) => string;
    to?: (v: string) => R;
    splitChars?: string[];
    data?: { value: string; label: string }[] | string[];
    label?: ReactNode;
    description?: ReactNode;
    required?: boolean;
  };

export const FormItemTagsInput = <T extends FieldValues, R>(
  props: FormItemTagsInputProps<T, R>
) => {
  const {
    controllerProps,
    restProps: {
      from,
      to,
      splitChars,
      data,
      label,
      description,
      required = false,
      ...restProps
    },
  } = genControllerProps(props);

  const {
    field: { value, onChange: fOnChange, onBlur: fOnBlur, ...restField },
    fieldState,
  } = useController<T>(controllerProps);

  const [searchValue, setSearchValue] = useState('');
  const selectedValue = Array.isArray(value) ? value : [];

  const options = data
    ? (data as Array<string | { value: string; label: string }>).map((item) =>
        typeof item === 'string' ? { value: item, label: item } : item
      )
    : restProps.options;
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
        mode="tags"
        value={
          from
            ? selectedValue.map(from as (v: unknown) => string)
            : selectedValue
        }
        status={fieldState.error ? 'error' : undefined}
        searchValue={searchValue}
        onSearch={setSearchValue}
        tokenSeparators={splitChars}
        options={options}
        onChange={(val) => {
          const mapped = to ? (val as string[]).map(to) : val;
          fOnChange((mapped as unknown[]).length > 0 ? mapped : undefined);
          restProps?.onChange?.(val, []);
          setSearchValue('');
        }}
        onBlur={() => {
          if (searchValue.trim()) {
            const newVal = [...(selectedValue as string[]), searchValue.trim()];
            const mapped = to ? newVal.map(to) : newVal;
            fOnChange(mapped);
            setSearchValue('');
          }
          fOnBlur();
        }}
        {...restField}
        {...restProps}
        style={{ width: '100%', ...restProps.style }}
        aria-label={ariaLabel}
      />
    </InputWrapper>
  );
};
