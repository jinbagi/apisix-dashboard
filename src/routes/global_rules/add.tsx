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
import { useMutation } from '@tanstack/react-query';
import {
  createFileRoute,
  useRouter as useReactRouter,
} from '@tanstack/react-router';
import { nanoid } from 'nanoid';
import { FormProvider, useForm } from 'react-hook-form';

import { putGlobalRuleReq } from '@/apis/global_rules';
import { formHistoryReq } from '@/apis/tracked-resource-write';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartGlobalRules } from '@/components/form-slice/FormPartGlobalRules';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import PageHeader from '@/components/page/PageHeader';
import { API_GLOBAL_RULES } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';
import { APISIX } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

const GlobalRuleAddForm = () => {
  const router = useReactRouter();

  const putGlobalRule = useMutation({
    mutationFn: async (d: APISIXType['GlobalRulePut']) => {
      const payload = prepareResourceFormPayload(d);
      const response = await putGlobalRuleReq(formHistoryReq, payload);
      return response;
    },
    async onSuccess(res) {
      await refreshResourceCaches('global_rules', API_GLOBAL_RULES);
      showNotification({
        id: 'add-global_rule',
        message: 'Global Rule created and verified',
        type: 'success',
      });
      try {
        await router.navigate({
          to: '/global_rules/detail/$id',
          params: { id: res.data.value.id },
        });
      } catch {
        showNotification({
          message:
            'Global Rule was created, but its detail page could not be opened automatically.',
          type: 'warning',
        });
      }
    },
  });

  const form = useForm({
    resolver: zodResolver(APISIX.GlobalRulePut, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    defaultValues: {
      plugins: {},
      id: nanoid(),
    },
    mode: 'onChange',
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs preparePayload={prepareResourceFormPayload} form={form} onSubmit={(d) => putGlobalRule.mutateAsync(d)} schema={APISIX.GlobalRulePut} submitLabel="Add">
        <FormSectionGeneral />
        <FormPartGlobalRules />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  return (
    <>
      <PageHeader showBackBtn
        title={`Add ${'Global Rule'}`}
      />
      <FormTOCBox>
        <GlobalRuleAddForm />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/global_rules/add')({
  component: RouteComponent,
});
