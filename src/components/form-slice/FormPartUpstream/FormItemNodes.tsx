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
import { EditableProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Typography } from 'antd';
import { nanoid } from 'nanoid';
import { equals, isNil } from 'rambdax';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type FieldValues,
  useController,
  type UseControllerProps,
} from 'react-hook-form';
import type { ZodObject, ZodRawShape } from 'zod';

import { InputWrapper } from '@/components/form/InputWrapper';
import { AntdConfigProvider } from '@/config/antdConfigProvider';
import type { InputWrapperProps } from '@/types/input-wrapper';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { upstreamNodeMapToArray, type UpstreamNodeRow,upstreamNodeRowsToPayload } from '@/utils/upstreamNodes';

import { genControllerProps } from '../../form/util';

type DataSource = UpstreamNodeRow;

const zValidateField = <T extends ZodRawShape, R extends keyof T>(
  zObj: ZodObject<T>,
  field: R,
  value: unknown
) => {
  const fieldSchema = zObj.shape[field];
  const res = fieldSchema.safeParse(value);
  if (res.success) {
    return Promise.resolve();
  }
  const error = res.error.issues[0];
  return Promise.reject(new Error(error.message));
};

const genRecord = (data?: DataSource | APISIXType['UpstreamNode']) => {
  const d = data ?? {
    host: '',
    port: 80,
    weight: 100,
    priority: 0,
  };
  return {
    ...d,
    __rowKey: nanoid(),
  } as DataSource;
};

const parseToDataSource = (data: APISIXType['UpstreamNodeListOrObj']) => {
  let val: APISIXType['UpstreamNodes'];
  if (isNil(data)) val = [];
  else if (Array.isArray(data)) val = data as APISIXType['UpstreamNodes'];
  else val = upstreamNodeMapToArray(data as APISIXType['UpstreamNodeObj']);
  return val.map(genRecord);
};

const genProps = (field: keyof APISIXType['UpstreamNode']) => {
  return {
    rules: [
      {
        validator: (_: unknown, value: unknown) =>
          zValidateField(APISIX.UpstreamNode, field, value),
      },
    ],
  };
};

export type FormItemNodesProps<T extends FieldValues> =
  UseControllerProps<T> & {
    onChange?: (value: APISIXType['UpstreamNode'][]) => void;
    defaultValue?: APISIXType['UpstreamNode'][];
  } & Pick<InputWrapperProps, 'label' | 'required' | 'withAsterisk'>;

const FormItemNodesInner = <T extends FieldValues>(
  props: FormItemNodesProps<T>
) => {
  const { controllerProps, restProps } = useMemo(
    () => genControllerProps(props),
    [props]
  );
  const {
    field: { value, onChange: fOnChange, name: fName, disabled },
    fieldState,
  } = useController<T>(controllerProps);
  const syncFormValue = useCallback(
    (data: DataSource[]) => {
      const vals = upstreamNodeRowsToPayload(data);
      fOnChange?.(vals);
      restProps.onChange?.(vals);
    },
    [fOnChange, restProps]
  );
  const { label, required, withAsterisk } = props;
  const [values, setValues] = useState<DataSource[]>([]);
  const [isDisabled, setIsDisabled] = useState(false);
  const setNodeValues = useCallback((data: DataSource[]) => {
    setValues((prev) => (equals(prev, data) ? prev : data));
  }, []);
  const syncNodeField = useCallback(
    (rowIndex: number, field: keyof APISIXType['UpstreamNode'], value: unknown) => {
      setValues((prev) => {
        const next = prev.map((item, index) =>
          index === rowIndex ? { ...item, [field]: value } : item
        );
        syncFormValue(next);
        return next;
      });
    },
    [syncFormValue]
  );
  const columns = useMemo<ProColumns<DataSource>[]>(
    () => [
      {
        title: 'Row',
        dataIndex: '__rowKey',
        hidden: true,
      },
      {
        title: 'Host',
        dataIndex: 'host',
        valueType: 'text',
        width: 200,
        fieldProps: (_, config) => ({
          'aria-label': 'Host',
          onBlur: (event: React.FocusEvent<HTMLInputElement>) =>
            syncNodeField(config.rowIndex, 'host', event.currentTarget.value),
        }),
        formItemProps: genProps('host'),
      },
      {
        title: 'Port',
        dataIndex: 'port',
        valueType: 'digit',
        width: 90,
        fieldProps: (_, config) => ({
          'aria-label': 'Port',
          onBlur: (event: React.FocusEvent<HTMLInputElement>) =>
            syncNodeField(config.rowIndex, 'port', event.currentTarget.value),
        }),
        formItemProps: genProps('port'),
        render: (_, entity) => {
          return entity.port?.toString() ?? 'Auto';
        },
      },
      {
        title: 'Weight',
        dataIndex: 'weight',
        valueType: 'digit',
        width: 90,
        fieldProps: (_, config) => ({
          'aria-label': 'Weight',
          onBlur: (event: React.FocusEvent<HTMLInputElement>) =>
            syncNodeField(config.rowIndex, 'weight', event.currentTarget.value),
        }),
        formItemProps: genProps('weight'),
        render: (_, entity) => {
          return entity.weight.toString();
        },
      },
      {
        title: 'Priority',
        dataIndex: 'priority',
        valueType: 'digit',
        width: 90,
        fieldProps: (_, config) => ({
          'aria-label': 'Priority',
          onBlur: (event: React.FocusEvent<HTMLInputElement>) =>
            syncNodeField(config.rowIndex, 'priority', event.currentTarget.value),
        }),
        formItemProps: genProps('priority'),
        render: (_, entity) => {
          return entity.priority?.toString() || '-';
        },
      },
      {
        title: 'Action',
        valueType: 'option',
        width: 72,
        hidden: disabled,
        render: () => null,
      },
    ],
    [disabled, syncNodeField]
  );
  useEffect(() => {
    const next = parseToDataSource(value);
    // Local edits already updated the rows. Keep their keys so typing does not
    // recreate the editable inputs; an external JSON replacement resets them.
    setValues((previous) => equals(JSON.parse(JSON.stringify(upstreamNodeRowsToPayload(previous))), JSON.parse(JSON.stringify(upstreamNodeRowsToPayload(next)))) ? previous : next);
  }, [value]);
  useEffect(() => {
    setIsDisabled(disabled || false);
  }, [disabled]);

  const editableKeys = isDisabled ? [] : values.map((item) => item.__rowKey);
  const nodeCount = values.length;
  const totalWeight = values.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);

  return (
    <InputWrapper
      error={fieldState.error?.message}
      fieldPath={controllerProps.name}
      label={label}
      required={required}
      withAsterisk={withAsterisk}
    >
      <input name={fName} type="hidden" />
      <div style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-md)' }}>
          {nodeCount} backend node{nodeCount === 1 ? '' : 's'} configured. Total weight: {totalWeight}. A blank port uses the scheme's default.
        </Typography.Text>
      </div>
      {nodeCount === 0 && (
        <Alert
          type="warning"
          showIcon
          message="No backend nodes are configured."
          description="Add at least one node here, or configure Service Discovery below."
          style={{ marginBottom: 12 }}
        />
      )}
      <AntdConfigProvider>
        <EditableProTable<DataSource>
          defaultSize="small"
          rowKey="__rowKey"
          bordered
          controlled
          scroll={{ x: 560 }}
          value={values}
          onChange={(dataSource) => {
            const next = [...dataSource];
            setNodeValues(next);
            syncFormValue(next);
          }}
          recordCreatorProps={false}
          columns={columns}
          editable={{
            type: 'multiple',
            editableKeys,
            onValuesChange(changedRecord, dataSource) {
              const next = dataSource.map((item) =>
                item.__rowKey === changedRecord.__rowKey
                  ? { ...item, ...changedRecord }
                  : item
              );
              setNodeValues(next);
              syncFormValue(next);
            },
            actionRender: (row) => {
              return [
                <Button
                  key="delete"
                  type="text"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => {
                    const next = values.filter((item) => item.__rowKey !== row.__rowKey);
                    setNodeValues(next);
                    syncFormValue(next);
                  }}
                >
                  Delete
                </Button>,
              ];
            },
          }}
        />
      </AntdConfigProvider>
      <Button
        style={{ marginTop: 8, width: '100%', borderColor: 'whitesmoke', ...(disabled && { display: 'none' }) }}
        size="small"
        onClick={() => {
          const next = [...values, genRecord()];
          setNodeValues(next);
          syncFormValue(next);
        }}
      >
        Add a Node
      </Button>
    </InputWrapper>
  );
};

export const FormItemNodes = FormItemNodesInner;
