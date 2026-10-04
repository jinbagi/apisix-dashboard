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
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { Skeleton } from 'antd';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';

import { getRouteQueryOptions } from '@/apis/hooks';
import { postRouteReq } from '@/apis/routes';
import { formHistoryReq } from '@/apis/tracked-resource-write';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartRoute } from '@/components/form-slice/FormPartRoute';
import {
  RoutePostSchema,
  type RoutePostType,
} from '@/components/form-slice/FormPartRoute/schema';
import { produceRoute } from '@/components/form-slice/FormPartRoute/util';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import PageHeader from '@/components/page/PageHeader';
import { API_ROUTES } from '@/config/constant';
import { ROUTE_REQUIRED_TEMPLATE } from '@/config/resourceTemplates';
import type { APISIXType } from '@/types/schema/apisix';
import { stripSystemReadonlyFields } from '@/utils/apisixEditable';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';

type Props = {
  navigate: (res: APISIXType['RespRouteDetail']) => Promise<void>;
  defaultValues?: Partial<RoutePostType>;
  enforcedValues?: Partial<RoutePostType>;
};

export const RouteAddForm = (props: Props) => {
  const { navigate, defaultValues, enforcedValues } = props;

  const postRoute = useMutation({
    mutationFn: async (d: RoutePostType) => {
      const payload = produceRoute({ ...d, ...enforcedValues });
      const response = await postRouteReq(formHistoryReq, payload);
      return response;
    },
    async onSuccess(response) {
      await refreshResourceCaches('routes', API_ROUTES);
      showNotification({
        message: 'Route created and verified',
        type: 'success',
      });
      try {
        await navigate(response);
      } catch {
        showNotification({
          message: 'Route was created, but its detail page could not be opened automatically.',
          type: 'warning',
        });
      }
    },
  });

  const form = useForm({
    resolver: zodResolver(RoutePostSchema, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    defaultValues: { ...defaultValues, ...enforcedValues },
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs
        form={form}
        preparePayload={produceRoute}
        onSubmit={(d) => postRoute.mutateAsync(d)}
        schema={RoutePostSchema}
        createJsonTemplate={defaultValues ? undefined : ROUTE_REQUIRED_TEMPLATE}
        submitLabel="Add"
      >
        <FormPartRoute />
      </FormJsonTabs>
    </FormProvider>
  );
};

const addSearchSchema = z.object({
  clone_from: z.string().optional(),
  service_id: z.string().optional(),
});

function RouteComponent() {
  const navigate = useNavigate();
  const { clone_from, service_id } = useSearch({ from: '/routes/add' });

  const { data: sourceData, isLoading } = useQuery({
    ...getRouteQueryOptions(clone_from ?? ''),
    enabled: !!clone_from,
    throwOnError: true,
  });

  const cloneValues = sourceData?.value
    ? (() => {
        const copy = stripSystemReadonlyFields(sourceData.value as Record<string, unknown>);
        if (copy.name) copy.name = `${copy.name} (copy)`;
        return copy as Partial<RoutePostType>;
      })()
    : undefined;

  if (clone_from && isLoading) {
    return (
      <>
        <PageHeader showBackBtn title="Clone Route" />
        <Skeleton active />
      </>
    );
  }

  return (
    <>
      <PageHeader
        showBackBtn
        title={clone_from ? 'Clone Route' : 'Add Route'}
        desc={
          clone_from
            ? `Cloning from ${clone_from}`
            : 'Match incoming traffic, then resolve it through a Service or directly to an Upstream.'
        }
      />
      <FormTOCBox>
        <RouteAddForm
          defaultValues={cloneValues ?? (service_id ? { service_id } as Partial<RoutePostType> : undefined)}
          navigate={(res) =>
            navigate({
              to: '/routes/detail/$id',
              params: { id: res.data.value.id },
            })
          }
        />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/routes/add')({
  component: RouteComponent,
  validateSearch: addSearchSchema,
});
