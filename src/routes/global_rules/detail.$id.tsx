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
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { Space } from 'antd';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useBoolean } from 'react-use';

import { putGlobalRuleReq } from '@/apis/global_rules';
import { getGlobalRuleQueryOptions } from '@/apis/hooks';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartGlobalRules } from '@/components/form-slice/FormPartGlobalRules';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { API_GLOBAL_RULES } from '@/config/constant';
import { req } from '@/config/req';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

type Props = {
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
};
const GlobalRuleDetailForm = (props: Props) => {
  const { readOnly } = props;
  const { id } = useParams({ from: '/global_rules/detail/$id' });
  const detailReq = useSuspenseQuery(getGlobalRuleQueryOptions(id));

  const form = useForm({
    resolver: zodResolver(APISIX.GlobalRulePut, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    defaultValues: {},
    mode: 'onChange',
    disabled: readOnly,
  });

  useEffect(() => {
    if (detailReq.data?.value) {
      form.reset(detailReq.data.value);
    }
  }, [detailReq.data, form]);

  const putGlobalRule = useMutation({
    mutationFn: (d: APISIXType['GlobalRulePut']) => putGlobalRuleReq(req, d),
    async onSuccess() {
      await detailReq.refetch({ throwOnError: true });
      showNotification({
        message: 'Global Rule saved and reloaded from APISIX',
        type: 'success',
      });
    },
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs
        preparePayload={prepareResourceFormPayload}
        form={form}
        onSubmit={(d) => putGlobalRule.mutateAsync(prepareResourceFormPayload(d))}
        submitLabel="Save"
        disabled={readOnly}
        rawData={detailReq.data?.value}
        adminApi={`${API_GLOBAL_RULES}/${id}`}
      >
        <FormSectionGeneral readOnly />
        <FormPartGlobalRules />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  const { id } = useParams({ from: '/global_rules/detail/$id' });
  const [readOnly, setReadOnly] = useBoolean(false);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader showBackBtn
        title={`Global Rule: ${id}`}
        extra={(
          <Space>
            <DeleteResourceBtn
              mode="detail"
              name="Global Rule"
              target={id}
              api={`${API_GLOBAL_RULES}/${id}`}
              onSuccess={() => navigate({ to: '/global_rules' })}
            />
          </Space>
        )}
      />
      <FormTOCBox>
        <GlobalRuleDetailForm readOnly={readOnly} setReadOnly={setReadOnly} />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/global_rules/detail/$id')({
  component: RouteComponent,
});
