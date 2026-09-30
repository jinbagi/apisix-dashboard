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
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { nanoid } from 'nanoid';
import { FormProvider, useForm } from 'react-hook-form';

import { putConsumerGroupReq } from '@/apis/consumer_groups';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartPluginConfig } from '@/components/form-slice/FormPartPluginConfig';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import PageHeader from '@/components/page/PageHeader';
import { API_CONSUMER_GROUPS } from '@/config/constant';
import { req } from '@/config/req';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { verifyAdminApiResource } from '@/utils/adminApiVerification';
import { stripSystemReadonlyFields } from '@/utils/apisixEditable';
import { showNotification } from '@/utils/notification';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

const ConsumerGroupAddForm = () => {
  const router = useRouter();

  const putConsumerGroup = useMutation({
    mutationFn: async (d: APISIXType['ConsumerGroupPut']) => {
      const payload = prepareResourceFormPayload(d);
      const response = await putConsumerGroupReq(req, payload);
      await verifyAdminApiResource(
        `${API_CONSUMER_GROUPS}/${payload.id}`,
        stripSystemReadonlyFields(payload as Record<string, unknown>)
      );
      return response;
    },
    async onSuccess(response) {
      showNotification({
        message: 'Consumer Group created and verified',
        type: 'success',
      });
      try {
        await router.navigate({
          to: '/consumer_groups/detail/$id',
          params: { id: response.data.value.id },
        });
      } catch {
        showNotification({
          message:
            'Consumer Group was created, but its detail page could not be opened automatically.',
          type: 'warning',
        });
      }
    },
  });

  const form = useForm({
    resolver: zodResolver(APISIX.ConsumerGroupPut, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    defaultValues: {
      id: nanoid(),
    },
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs preparePayload={prepareResourceFormPayload} form={form} onSubmit={(d) => putConsumerGroup.mutateAsync(d)} schema={APISIX.ConsumerGroupPut} submitLabel="Add">
        <FormSectionGeneral />
        <FormPartPluginConfig basicProps={{}} />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  return (
    <>
      <PageHeader showBackBtn
        title={`Add ${'Consumer Group'}`}
      />
      <FormTOCBox>
        <ConsumerGroupAddForm />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/consumer_groups/add')({
  component: RouteComponent,
});
