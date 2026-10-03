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
import { type FieldValues, useFormContext } from 'react-hook-form';

import type { APISIXType } from '@/types/schema/apisix';

import {
  FormItemTextareaWithUpload,
  type FormItemTextareaWithUploadProps,
} from '../form/TextareaWithUpload';
import { FormPartBasic } from './FormPartBasic';

const fileTypes = '.proto,.pb';
export const FormPartProto = <T extends FieldValues>(
  { showID = true, ...props }: Pick<
    FormItemTextareaWithUploadProps<T>,
    'allowUpload'
  > & { showID?: boolean }
) => {
  const form = useFormContext<APISIXType['ProtoPost']>();
  return (
    <>
      <FormPartBasic showID={showID} />
      <FormItemTextareaWithUpload
        name="content"
        label="Content"
        placeholder={`Paste or upload ${fileTypes} file`}
        control={form.control}
        minRows={10}
        acceptFileTypes={fileTypes}
        {...props}
      />
    </>
  );
};
