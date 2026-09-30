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
import { FormProvider, useForm } from 'react-hook-form';

import { postProtoReq } from '@/apis/protos';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartProto } from '@/components/form-slice/FormPartProto';
import PageHeader from '@/components/page/PageHeader';
import { API_PROTOS } from '@/config/constant';
import { req } from '@/config/req';
import type { APISIXType } from '@/types/schema/apisix';
import { APISIXProtos } from '@/types/schema/apisix/protos';
import { verifyAdminApiResource } from '@/utils/adminApiVerification';
import { stripSystemReadonlyFields } from '@/utils/apisixEditable';
import { showNotification } from '@/utils/notification';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

const defaultValues: APISIXType['ProtoPost'] = {
  content: '',
};

const ProtoAddForm = () => {
  const router = useReactRouter();

  const postProto = useMutation({
    mutationFn: async (d: APISIXType['ProtoPost']) => {
      const payload = prepareResourceFormPayload(d);
      const response = await postProtoReq(req, payload);
      await verifyAdminApiResource(
        `${API_PROTOS}/${response.data.value.id}`,
        stripSystemReadonlyFields(payload as Record<string, unknown>)
      );
      return response;
    },
    async onSuccess(response) {
      showNotification({
        message: 'Proto created and verified',
        type: 'success',
      });
      try {
        await router.navigate({
          to: '/protos/detail/$id',
          params: { id: response.data.value.id },
        });
      } catch {
        showNotification({
          message:
            'Proto was created, but its detail page could not be opened automatically.',
          type: 'warning',
        });
      }
    },
  });

  const form = useForm({
    resolver: zodResolver(APISIXProtos.ProtoPost, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    defaultValues,
    mode: 'onChange',
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs preparePayload={prepareResourceFormPayload} form={form} onSubmit={(d) => postProto.mutateAsync(d)} schema={APISIXProtos.ProtoPost} submitLabel="Add">
        <FormPartProto />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  return (
    <>
      <PageHeader showBackBtn title={`Add ${'Proto'}`} />
      <ProtoAddForm />
    </>
  );
}

export const Route = createFileRoute('/protos/add')({
  component: RouteComponent,
});
