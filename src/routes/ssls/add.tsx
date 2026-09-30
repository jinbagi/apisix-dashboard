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

import { postSSLReq } from '@/apis/ssls';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartSSL } from '@/components/form-slice/FormPartSSL';
import {
  produceSSLSubmitPayload,
  SSLPostSchema,
  type SSLPostType,
} from '@/components/form-slice/FormPartSSL/schema';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import PageHeader from '@/components/page/PageHeader';
import { API_SSLS } from '@/config/constant';
import { queryClient } from '@/config/global';
import { req } from '@/config/req';
import { verifyAdminApiExists } from '@/utils/adminApiVerification';
import { showNotification } from '@/utils/notification';

const SSLAddForm = () => {
  const router = useRouter();
  const postSSL = useMutation({
    mutationFn: async (d: SSLPostType) => {
      const payload = produceSSLSubmitPayload(d);
      const response = await postSSLReq(req, payload);
      await verifyAdminApiExists(`${API_SSLS}/${response.data.value.id}`);
      return response;
    },
    async onSuccess() {
      showNotification({
        message: 'SSL created and verified',
        type: 'success',
      });
      try {
        await queryClient.invalidateQueries({ queryKey: ['ssls'] });
        await router.navigate({
          to: '/ssls',
        });
      } catch {
        showNotification({
          message:
            'SSL was created, but the refreshed SSL list could not be opened automatically.',
          type: 'warning',
        });
      }
    },
  });

  const form = useForm({
    resolver: zodResolver(SSLPostSchema, undefined, { raw: true }),
    shouldUnregister: false,
    mode: 'all',
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs preparePayload={produceSSLSubmitPayload} form={form} onSubmit={(d) => postSSL.mutateAsync(d)} schema={SSLPostSchema} submitLabel="Add">
        <FormPartSSL />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  return (
    <>
      <PageHeader showBackBtn title={`Add ${'SSL'}`} />
      <FormTOCBox>
        <SSLAddForm />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/ssls/add')({
  component: RouteComponent,
});
