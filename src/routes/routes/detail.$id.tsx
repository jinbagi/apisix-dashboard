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
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { Button, Space } from 'antd';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import { getRouteQueryOptions } from '@/apis/hooks';
import { putRouteReq } from '@/apis/routes';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartRoute } from '@/components/form-slice/FormPartRoute';
import {
  RoutePutSchema,
  type RoutePutType,
} from '@/components/form-slice/FormPartRoute/schema';
import {
  produceRoute,
  produceVarsToForm,
} from '@/components/form-slice/FormPartRoute/util';
import { produceToUpstreamForm } from '@/components/form-slice/FormPartUpstream/util';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { StatusSwitch } from '@/components/StatusTag';
import { API_ROUTES } from '@/config/constant';
import { req } from '@/config/req';
import { type APISIXType } from '@/types/schema/apisix';
import { verifyAdminApiResource } from '@/utils/adminApiVerification';
import { buildPatchPayload, stripSystemReadonlyFields } from '@/utils/apisixEditable';
import { showNotification } from '@/utils/notification';

type Props = {
  id: string;
  enforcedValues?: Partial<RoutePutType>;
};

const RouteDetailForm = (props: Props) => {
  const { id, enforcedValues } = props;

  const routeQuery = useSuspenseQuery(getRouteQueryOptions(id));
  const { data: routeData, refetch } = routeQuery;

  const form = useForm({
    resolver: zodResolver(RoutePutSchema, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
  });

  useEffect(() => {
    if (routeData.value) {
      const upstreamProduced = produceToUpstreamForm(
        routeData.value.upstream || {},
        routeData.value
      );
      form.reset(
        produceVarsToForm({
          ...upstreamProduced,
          ...enforcedValues,
        }) as RoutePutType
      );
    }
  }, [enforcedValues, routeData, form]);

  const putRoute = useMutation({
    mutationFn: async (d: RoutePutType) => {
      const payload = produceRoute({ ...d, ...enforcedValues }) as APISIXType['Route'];
      const response = await putRouteReq(req, payload);
      await verifyAdminApiResource(
        `${API_ROUTES}/${id}`,
        buildPatchPayload(
          stripSystemReadonlyFields(payload),
          stripSystemReadonlyFields(routeData.value)
        ),
        { ignoredPaths: ['upstream.tls.client_key'] }
      );
      return response;
    },
    async onSuccess() {
      await refetch({ throwOnError: true });
      showNotification({
        message: 'Route saved and reloaded from APISIX',
        type: 'success',
      });
    },
  });

  return (
    <>
      <FormProvider {...form}>
        <FormJsonTabs
          form={form}
        preparePayload={produceRoute}
          onSubmit={(d) => putRoute.mutateAsync(d)}
          submitLabel="Save"
          rawData={routeData?.value}
          adminApi={`${API_ROUTES}/${id}`}
        >
          <FormSectionGeneral readOnly />
          <FormPartRoute showID={false} />
        </FormJsonTabs>
      </FormProvider>
    </>
  );
};

type RouteDetailProps = Pick<Props, 'id'> & {
  onDeleteSuccess: () => void;
  enforcedValues?: Partial<RoutePutType>;
};
export const RouteDetail = (props: RouteDetailProps) => {
  const { id, onDeleteSuccess, enforcedValues } = props;
  const { data: routeData } = useSuspenseQuery(getRouteQueryOptions(id));

  return (
    <>
      <PageHeader showBackBtn
        title={`Route: ${routeData.value.name || id}`}
        desc={`ID: ${id} - Matches incoming traffic and resolves it through a Service or directly to an Upstream.`}
        extra={(
          <Space>
            <StatusSwitch api={`${API_ROUTES}/${id}`} />
            <Link to="/routes/add" search={{ clone_from: id }}>
              <Button size="small">Clone</Button>
            </Link>
            <DeleteResourceBtn
              mode="detail"
              name="Route"
              target={id}
              api={`${API_ROUTES}/${id}`}
              onSuccess={onDeleteSuccess}
            />
          </Space>
        )}
      />
      <FormTOCBox>
        <RouteDetailForm
          id={id}
          enforcedValues={enforcedValues}
        />
      </FormTOCBox>
    </>
  );
};

function RouteComponent() {
  const { id } = useParams({ from: '/routes/detail/$id' });
  const navigate = useNavigate();
  return (
    <RouteDetail id={id} onDeleteSuccess={() => navigate({ to: '/routes' })} />
  );
}

export const Route = createFileRoute('/routes/detail/$id')({
  component: RouteComponent,
});
