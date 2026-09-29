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
import { useRouter } from '@tanstack/react-router';
import { Button, type ButtonProps,Space } from 'antd';
import { useFormContext, useFormState } from 'react-hook-form';

export const FormSubmitBtn = (props: ButtonProps) => {
  const form = useFormContext();
  const { isSubmitting } = useFormState(form);
  // Keep the action's accessible name stable while Ant Design animates its
  // loading icon. Expose progress separately instead of naming it "loading Save".
  const loading = props.loading ?? isSubmitting;
  return (
    <Button
      type="primary"
      size="middle"
      htmlType="submit"
      disabled={isSubmitting}
      aria-label={typeof props.children === 'string' ? props.children : undefined}
      aria-busy={!!loading}
      {...props}
      loading={loading}
    />
  );
};

export const FormSubmitBtnWithCancel = (props: ButtonProps) => {
  const router = useRouter();
  return (
    <Space>
      <FormSubmitBtn {...props} />
      <Button size="middle" onClick={() => router.history.back()}>
        Cancel
      </Button>
    </Space>
  );
};
