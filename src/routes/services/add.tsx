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
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, useRouter, useSearch } from '@tanstack/react-router';
import { Skeleton } from 'antd';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';

import { getServiceQueryOptions } from '@/apis/hooks';
import { postServiceReq, type ServicePostType } from '@/apis/services';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartService } from '@/components/form-slice/FormPartService';
import { ServicePostSchema } from '@/components/form-slice/FormPartService/schema';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import PageHeader from '@/components/page/PageHeader';
import { API_SERVICES } from '@/config/constant';
import { req } from '@/config/req';
import { SERVICE_REQUIRED_TEMPLATE } from '@/config/resourceTemplates';
import { verifyAdminApiResource } from '@/utils/adminApiVerification';
import { stripSystemReadonlyFields } from '@/utils/apisixEditable';
import { showNotification } from '@/utils/notification';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

const ServiceAddForm = ({ defaultValues }: { defaultValues?: ServicePostType }) => {
  const router = useRouter();

  const postService = useMutation({
    mutationFn: async (d: ServicePostType) => {
      const payload = prepareResourceFormPayload(d);
      const response = await postServiceReq(
        req,
        payload
      );
      const id = response.data.value.id;
      await verifyAdminApiResource(
        `${API_SERVICES}/${id}`,
        stripSystemReadonlyFields(payload as Record<string, unknown>),
        { ignoredPaths: ['upstream.tls.client_key'] }
      );
      return response;
    },
    async onSuccess(response) {
      showNotification({
        message: 'Service created and verified',
        type: 'success',
      });
      try {
        await router.navigate({
          to: '/services/detail/$id',
          params: { id: response.data.value.id },
        });
      } catch {
        showNotification({
          message:
            'Service was created, but its detail page could not be opened automatically.',
          type: 'warning',
        });
      }
    },
  });

  const form = useForm({
    resolver: zodResolver(ServicePostSchema, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    defaultValues,
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs
        preparePayload={prepareResourceFormPayload}
        form={form}
        onSubmit={(d) => postService.mutateAsync(d)}
        schema={ServicePostSchema}
        createJsonTemplate={SERVICE_REQUIRED_TEMPLATE}
        submitLabel="Add"
      >
        <FormPartService />
      </FormJsonTabs>
    </FormProvider>
  );
};

const addSearchSchema = z.object({
  clone_from: z.string().optional(),
  upstream_id: z.string().optional(),
});

function RouteComponent() {
  const { clone_from, upstream_id } = useSearch({ from: '/services/add' });

  const { data: sourceData, isLoading } = useQuery({
    ...getServiceQueryOptions(clone_from ?? ''),
    enabled: !!clone_from,
    throwOnError: true,
  });

  const cloneValues = sourceData?.value
    ? (() => {
        const copy = stripSystemReadonlyFields(sourceData.value as Record<string, unknown>);
        if (copy.name) copy.name = `${copy.name} (copy)`;
        return copy as ServicePostType;
      })()
    : undefined;

  if (clone_from && isLoading) {
    return (
      <>
        <PageHeader showBackBtn title="Clone Service" />
        <Skeleton active />
      </>
    );
  }

  return (
    <>
      <PageHeader
        showBackBtn
        title={clone_from ? 'Clone Service' : 'Add Service'}
        desc={
          clone_from
            ? `Cloning from ${clone_from}`
            : 'Create reusable traffic policy, then connect it to a reusable or inline Upstream.'
        }
      />
      <FormTOCBox>
        <ServiceAddForm defaultValues={cloneValues ?? (upstream_id ? { upstream_id } as ServicePostType : undefined)} />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/services/add')({
  component: RouteComponent,
  validateSearch: addSearchSchema,
});
