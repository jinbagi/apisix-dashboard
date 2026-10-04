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
import { Alert, Modal, Radio, Select } from 'antd';
import { useEffect, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { FormItemTagsInput } from '@/components/form/TagInput';
import { FormItemTextInput } from '@/components/form/TextInput';

import type { RoutePostType } from './schema';

/** Keep the API's scalar/array distinction without making users edit both. */
export const MatchField = ({ single, multiple, label, pluralLabel, placeholder, help, required = false }: {
  single: 'uri' | 'host' | 'remote_addr';
  multiple: 'uris' | 'hosts' | 'remote_addrs';
  label: string;
  pluralLabel: string;
  placeholder: string;
  help: string;
  required?: boolean;
}) => {
  const { control, setValue, clearErrors } = useFormContext<RoutePostType>();
  const value = useWatch({ control, name: single });
  const values = useWatch({ control, name: multiple });
  const [many, setMany] = useState(!!values?.length);
  const [chooseOne, setChooseOne] = useState(false);
  const [keptValue, setKeptValue] = useState<string>();
  const conflict = !!value && !!values?.length;

  useEffect(() => {
    if (values?.length) setMany(true);
    else if (value) setMany(false);
  }, [value, values]);

  const selectSingle = (kept?: string) => {
    setValue(multiple, undefined, { shouldDirty: true });
    setValue(single, kept ?? '', { shouldDirty: true, shouldValidate: true });
    clearErrors(multiple);
    setMany(false);
    setChooseOne(false);
  };

  const changeMode = (nextMany: boolean) => {
    if (nextMany) {
      setValue(single, undefined, { shouldDirty: true });
      setValue(multiple, values?.length ? values : value ? [value] : [], { shouldDirty: true, shouldValidate: true });
      clearErrors(single);
      setMany(true);
    } else if ((values?.length ?? 0) > 1 || conflict) {
      setKeptValue(value || values?.[0]);
      setChooseOne(true);
    } else selectSingle(value || values?.[0]);
  };

  return (
    <div role="group" aria-label={`${label} matching`} style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <strong>{label}{required && <span style={{ color: 'var(--ant-color-error)' }}> *</span>}</strong>
        <Radio.Group
          aria-label={`${label} mode`}
          size="small"
          optionType="button"
          buttonStyle="solid"
          value={many}
          disabled={conflict}
          options={[{ label: 'Single', value: false }, { label: 'Multiple', value: true }]}
          onChange={(event) => changeMode(event.target.value)}
        />
      </div>
      {conflict && <Alert type="warning" showIcon title={`Both ${single} and ${multiple} are set. Clear one below to resolve the conflict.`} style={{ marginBottom: 8 }} />}
      {(!many || conflict) && <FormItemTextInput control={control} name={single} aria-label={label} aria-required={required} placeholder={placeholder} description={help} required={required} />}
      {(many || conflict) && <FormItemTagsInput control={control} name={multiple} aria-label={pluralLabel} aria-required={required} placeholder={`${placeholder} — press Enter to add`} description={help} required={required} splitChars={[',']} />}
      <Modal title={`Keep one ${label.toLowerCase()}`} open={chooseOne} onCancel={() => setChooseOne(false)} onOk={() => selectSingle(keptValue)} okText="Keep selected value" okButtonProps={{ disabled: !keptValue }}>
        <p>Single mode keeps one value. The other values will be removed from this draft.</p>
        <Select aria-label={`Keep one ${label}`} value={keptValue} onChange={setKeptValue} style={{ width: '100%' }} options={[...new Set([...(value ? [value] : []), ...(values ?? [])])].map((item) => ({ value: item, label: item }))} />
      </Modal>
    </div>
  );
};
