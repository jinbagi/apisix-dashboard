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
import { Switch, type SwitchProps } from 'antd';
import type { ReactNode } from 'react';
import {
  type FieldValues,
  useController,
  type UseControllerProps,
} from 'react-hook-form';

import classes from './Switch.module.css';
import { genControllerProps, getAccessibleFieldLabel } from './util';

type AccessibleSwitchProps = SwitchProps & {
  'aria-label'?: string;
};

export type FormItemSwitchProps<T extends FieldValues> = Omit<
  UseControllerProps<T> & AccessibleSwitchProps,
  'defaultValue'
> & {
  label?: ReactNode;
  description?: ReactNode;
};

export const FormItemSwitch = <T extends FieldValues>(
  props: FormItemSwitchProps<T>
) => {
  const { controllerProps, restProps } = genControllerProps(props);
  const { label, description, ...switchProps } = restProps;
  const accessibleLabel =
    switchProps['aria-label'] ?? getAccessibleFieldLabel(label);
  const {
    field: { value, onChange: fOnChange, ...restField },
  } = useController<T>(controllerProps);
  return (
    <div className={classes.switchWrapper}>
      <div className={classes.switchRow}>
        <Switch
          {...restField}
          {...switchProps}
          checked={!!value}
          onChange={(checked, e) => {
            fOnChange(checked);
            switchProps.onChange?.(checked, e);
          }}
          aria-label={accessibleLabel}
        />
        {label && <span className={classes.switchLabel}>{label}</span>}
      </div>
      {description && (
        <div className={classes.switchDescription}>
          {description}
        </div>
      )}
    </div>
  );
};
