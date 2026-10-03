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
import { Divider } from 'antd';
import { useFormContext, useWatch } from 'react-hook-form';

import type { APISIXType } from '@/types/schema/apisix';

import { FormItemTextInput } from '../form/TextInput';
import { FormDisplayDate } from './FormDisplayDate';
import { FormSection } from './FormSection';

const DisplayDate = () => {
  const { control } = useFormContext<APISIXType['Info']>();
  const createTime = useWatch({ control, name: 'create_time' });
  const updateTime = useWatch({ control, name: 'update_time' });
  return (
    <>
      <FormDisplayDate date={createTime} label="Created At" />
      <FormDisplayDate date={updateTime} label="Updated At" />
    </>
  );
};

const FormItemID = ({ readOnly }: { readOnly: boolean }) => {
  const { control } = useFormContext<APISIXType['Info']>();
  return (
    <FormItemTextInput
      control={control}
      name="id"
      label="ID"
      description={readOnly ? undefined : 'Use the generated ID or replace it with your own. You can also set id in Payload JSON.'}
    />
  );
};

export type FormSectionGeneralProps = {
  /** will be default to `readOnly` */
  showDate?: boolean;
  showID?: boolean;
  readOnly?: boolean;
};

export const FormSectionGeneral = (props: FormSectionGeneralProps) => {
  const { showDate = props.readOnly, showID = true, readOnly = false } = props;
  const { register } = useFormContext<APISIXType['Info']>();
  // we use fieldset disabled to show readonly state
  // because mantine readOnly style looks like we can edit
  // this is also the way rhf recommends,
  // Using disable directly on the component will cause rhf to ignore the value
  return (
    <FormSection legend="General" disabled={readOnly}>
      {showID && <FormItemID readOnly={readOnly} />}
      {showID && showDate && <Divider style={{ margin: '16px 0' }} />}
      <input type="hidden" {...register('create_time')} />
      <input type="hidden" {...register('update_time')} />
      {showDate && <DisplayDate />}
    </FormSection>
  );
};
