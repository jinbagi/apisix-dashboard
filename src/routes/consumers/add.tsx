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
import { FormProvider, useForm } from 'react-hook-form';

import { putConsumerReq } from '@/apis/consumers';
import { formHistoryReq } from '@/apis/tracked-resource-write';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartConsumer } from '@/components/form-slice/FormPartConsumer';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import PageHeader from '@/components/page/PageHeader';
import { API_CONSUMERS } from '@/config/constant';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

const ConsumerAddForm = () => {
  const router = useRouter();

  const putConsumer = useMutation({
    mutationFn: async (d: APISIXType['ConsumerPut']) => {
      const payload = prepareResourceFormPayload(d);
      const response = await putConsumerReq(formHistoryReq, payload);
      return { response, username: payload.username };
    },
    async onSuccess({ username }) {
      await refreshResourceCaches('consumers', API_CONSUMERS);
      showNotification({
        message: 'Consumer created and verified',
        type: 'success',
      });
      try {
        await router.navigate({
          to: '/consumers/detail/$username',
          params: { username },
        });
      } catch {
        showNotification({
          message:
            'Consumer was created, but its detail page could not be opened automatically.',
          type: 'warning',
        });
      }
    },
  });

  const form = useForm({
    resolver: zodResolver(APISIX.ConsumerPut, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs preparePayload={prepareResourceFormPayload} form={form} onSubmit={(d) => putConsumer.mutateAsync(d)} schema={APISIX.ConsumerPut} submitLabel="Add">
        <FormPartConsumer />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  return (
    <>
      <PageHeader showBackBtn
        title={`Add ${'Consumer'}`}
      />
      <FormTOCBox>
        <ConsumerAddForm />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/consumers/add')({
  component: RouteComponent,
});
