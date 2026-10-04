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

import { getUpstreamQueryOptions } from '@/apis/hooks';
import { formHistoryReq } from '@/apis/tracked-resource-write';
import { postUpstreamReq } from '@/apis/upstreams';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartUpstream } from '@/components/form-slice/FormPartUpstream';
import { UpstreamPostSchema } from '@/components/form-slice/FormPartUpstream/schema';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import PageHeader from '@/components/page/PageHeader';
import { API_UPSTREAMS } from '@/config/constant';
import { UPSTREAM_REQUIRED_TEMPLATE } from '@/config/resourceTemplates';
import { stripSystemReadonlyFields } from '@/utils/apisixEditable';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { prepareUpstreamFormPayload } from '@/utils/resourceFormPayload';

type PostUpstreamType = z.infer<typeof UpstreamPostSchema>;

const UpstreamAddForm = ({ defaultValues }: { defaultValues?: PostUpstreamType }) => {
  const router = useRouter();
  const postUpstream = useMutation({
    mutationFn: async (d: PostUpstreamType) => {
      const payload = prepareUpstreamFormPayload(d);
      const response = await postUpstreamReq(formHistoryReq, payload);
      return response;
    },
    async onSuccess(response) {
      await refreshResourceCaches('upstreams', API_UPSTREAMS);
      showNotification({
        message: 'Upstream created and verified',
        type: 'success',
      });
      try {
        await router.navigate({
          to: '/upstreams/detail/$id',
          params: { id: response.data.value.id },
        });
      } catch {
        showNotification({
          message:
            'Upstream was created, but its detail page could not be opened automatically.',
          type: 'warning',
        });
      }
    },
  });
  const form = useForm({
    resolver: zodResolver(UpstreamPostSchema, undefined, { raw: true }),
    shouldUnregister: false,
    mode: 'all',
    defaultValues,
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs
        preparePayload={prepareUpstreamFormPayload}
        form={form}
        onSubmit={(d) => postUpstream.mutateAsync(d)}
        schema={UpstreamPostSchema}
        createJsonTemplate={UPSTREAM_REQUIRED_TEMPLATE}
        submitLabel="Add"
      >
        <FormPartUpstream />
      </FormJsonTabs>
    </FormProvider>
  );
};

const addSearchSchema = z.object({
  clone_from: z.string().optional(),
});

function RouteComponent() {
  const { clone_from } = useSearch({ from: '/upstreams/add' });

  const { data: sourceData, isLoading } = useQuery({
    ...getUpstreamQueryOptions(clone_from ?? ''),
    enabled: !!clone_from,
    throwOnError: true,
  });

  const cloneValues = sourceData?.value
    ? (() => {
        const copy = stripSystemReadonlyFields(sourceData.value as Record<string, unknown>);
        if (copy.name) copy.name = `${copy.name} (copy)`;
        return copy as PostUpstreamType;
      })()
    : undefined;

  if (clone_from && isLoading) {
    return (
      <>
        <PageHeader showBackBtn title="Clone Upstream" />
        <Skeleton active />
      </>
    );
  }

  return (
    <>
      <PageHeader
        showBackBtn
        title={clone_from ? 'Clone Upstream' : 'Add Upstream'}
        desc={
          clone_from
            ? `Cloning from ${clone_from}`
            : 'Define backend nodes or service discovery, followed by connection and health policy.'
        }
      />
      <FormTOCBox>
        <UpstreamAddForm defaultValues={cloneValues} />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/upstreams/add')({
  component: RouteComponent,
  validateSearch: addSearchSchema,
});
