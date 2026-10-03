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
import { type PropsWithChildren, type ReactNode, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';

import type { APISIXType } from '@/types/schema/apisix';
import { APISIXCommon } from '@/types/schema/apisix/common';
import { useNamePrefix } from '@/utils/useNamePrefix';

import { FormItemLabels } from '../form/Labels';
import { FormItemSelect } from '../form/Select';
import { FormItemTextarea } from '../form/Textarea';
import { FormItemTextInput } from '../form/TextInput';
import { FormSection, type FormSectionProps } from './FormSection';

const statusLabels: Record<string, string> = { '0': 'Disabled', '1': 'Enabled' };

const FormItemStatus = () => {
  const { control } = useFormContext<APISIXType['Basic']>();
  const np = useNamePrefix();
  const options = useMemo(
    () =>
      APISIXCommon.Status.options.map((v) => ({
        value: String(v.value),
        label: statusLabels[String(v.value)] ?? String(v.value),
      })),
    []
  );
  return (
    <FormItemSelect
      control={control}
      name={np('status')}
      label="Status"
      defaultValue={APISIXCommon.Status.options[1].value}
      data={options}
      from={String}
      to={Number}
    />
  );
};

export type FormPartBasicProps = Omit<FormSectionProps, 'form'> &
  PropsWithChildren & {
    before?: ReactNode;
    showStatus?: boolean;
    showID?: boolean;
    showName?: boolean;
    showDesc?: boolean;
    showLabels?: boolean;
  };

export const FormPartBasic = (props: FormPartBasicProps) => {
  const {
    before,
    children,
    showStatus = false,
    showID = true,
    showName = true,
    showDesc = true,
    showLabels = true,
    ...restProps
  } = props;
  const { control } = useFormContext<APISIXType['Basic'] & { id?: string }>();
  const np = useNamePrefix();

  return (
    <FormSection legend="Basic Information" {...restProps}>
      {showID && (
        <FormItemTextInput
          name={np('id')}
          label="ID"
          description="Choose your own ID, or leave empty for an auto-generated ID. You can also set id in Payload JSON."
          control={control}
          placeholder="Enter a custom ID (optional)"
        />
      )}
      {before}
      {showName && (
        <FormItemTextInput
          name={np('name')}
          label="Name"
          control={control}
        />
      )}
      {showDesc && (
        <FormItemTextarea
          name={np('desc')}
          label="Description"
          control={control}
        />
      )}
      {showLabels && (
        <FormItemLabels
          name={np('labels')}
          label="Labels"
          control={control}
        />
      )}
      {showStatus && <FormItemStatus />}
      {children}
    </FormSection>
  );
};
