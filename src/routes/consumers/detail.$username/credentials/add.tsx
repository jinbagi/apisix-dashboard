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
import { createFileRoute, useParams, useRouter } from '@tanstack/react-router';
import { nanoid } from 'nanoid';
import { FormProvider, useForm } from 'react-hook-form';

import { putCredentialReq } from '@/apis/credentials';
import { formHistoryReq } from '@/apis/tracked-resource-write';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartCredential } from '@/components/form-slice/FormPartCredential';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import PageHeader from '@/components/page/PageHeader';
import { API_CREDENTIALS } from '@/config/constant';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

const CredentialAddForm = () => {
  const router = useRouter();
  const { username } = useParams({
    from: '/consumers/detail/$username/credentials/add',
  });

  const putCredential = useMutation({
    mutationFn: async (d: APISIXType['CredentialPut']) => {
      const payload = prepareResourceFormPayload({ ...d, username });
      const response = await putCredentialReq(formHistoryReq, payload);
      const id = payload.id;
      return { response, id };
    },
    async onSuccess({ id }) {
      await refreshResourceCaches(['credentials', username], API_CREDENTIALS(username));
      showNotification({
        message: 'Credential created and verified',
        type: 'success',
      });
      try {
        await router.navigate({
          to: '/consumers/detail/$username/credentials/detail/$id',
          params: { username, id },
        });
      } catch {
        showNotification({
          message:
            'Credential was created, but its detail page could not be opened automatically.',
          type: 'warning',
        });
      }
    },
  });

  const form = useForm({
    resolver: zodResolver(APISIX.CredentialPut, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    defaultValues: {
      id: nanoid(),
    },
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs preparePayload={prepareResourceFormPayload} form={form} onSubmit={(d) => putCredential.mutateAsync(d)} schema={APISIX.CredentialPut} submitLabel="Add">
        <FormSectionGeneral />
        <FormPartCredential />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  return (
    <>
      <PageHeader showBackBtn
        title={`Add ${'Credential'}`}
      />
      <FormTOCBox>
        <CredentialAddForm />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute(
  '/consumers/detail/$username/credentials/add'
)({
  component: RouteComponent,
});
