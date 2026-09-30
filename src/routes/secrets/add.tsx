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

import { putSecretReq } from '@/apis/secrets';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartSecret } from '@/components/form-slice/FormPartSecret';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import PageHeader from '@/components/page/PageHeader';
import { API_SECRETS } from '@/config/constant';
import { req } from '@/config/req';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { verifyAdminApiExists } from '@/utils/adminApiVerification';
import { showNotification } from '@/utils/notification';
import { refreshCreatedResource } from '@/utils/resourceCache';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

const SecretAddForm = () => {
  const router = useRouter();

  const putSecret = useMutation({
    mutationFn: async (d: APISIXType['Secret']) => {
      const payload = prepareResourceFormPayload(d);
      const response = await putSecretReq(req, payload);
      await verifyAdminApiExists(
        `${API_SECRETS}/${payload.manager}/${payload.id}`
      );
      return response;
    },
    async onSuccess() {
      await refreshCreatedResource('secrets', API_SECRETS);
      showNotification({
        message: 'Secret created and verified',
        type: 'success',
      });
      try {
        await router.navigate({
          to: '/secrets',
        });
      } catch {
        showNotification({
          message:
            'Secret was created, but the refreshed Secret list could not be opened automatically.',
          type: 'warning',
        });
      }
    },
  });

  const form = useForm({
    resolver: zodResolver(APISIX.Secret, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    defaultValues: {
      id: nanoid(),
      manager: APISIX.Secret.options[0].shape.manager.value,
    },
    mode: 'all',
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs preparePayload={prepareResourceFormPayload} form={form} onSubmit={(d) => putSecret.mutateAsync(d)} schema={APISIX.Secret} submitLabel="Add">
        <FormSectionGeneral />
        <FormPartSecret />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  return (
    <>
      <PageHeader showBackBtn
        title={`Add ${'Secret'}`}
      />
      <FormTOCBox>
        <SecretAddForm />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/secrets/add')({
  component: RouteComponent,
});
