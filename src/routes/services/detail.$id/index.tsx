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
import { Button, Skeleton, Space } from 'antd';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import { getServiceQueryOptions } from '@/apis/hooks';
import { putServiceReq } from '@/apis/services';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartService } from '@/components/form-slice/FormPartService';
import { ServicePutSchema } from '@/components/form-slice/FormPartService/schema';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { ConfigurationImpact } from '@/components/page/ConfigurationImpact';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { ReverseReferences } from '@/components/page/ReverseReferences';
import { API_SERVICES } from '@/config/constant';
import { req } from '@/config/req';
import type { APISIXType } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

const ServiceDetailForm = () => {
  const { id } = useParams({ from: '/services/detail/$id' });

  const serviceQuery = useSuspenseQuery(getServiceQueryOptions(id));
  const { data: serviceData, isLoading, refetch } = serviceQuery;

  const form = useForm({
    resolver: zodResolver(ServicePutSchema, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
  });

  useEffect(() => {
    if (serviceData?.value && !isLoading) {
      form.reset(serviceData.value);
    }
  }, [serviceData, form, isLoading]);

  const putService = useMutation({
    mutationFn: (d: APISIXType['Service']) =>
      putServiceReq(
        req,
        prepareResourceFormPayload(d)
      ),
    async onSuccess() {
      await refetch({ throwOnError: true });
      await refreshResourceCaches('services', API_SERVICES);
      showNotification({
        message: 'Service saved and reloaded from APISIX',
        type: 'success',
      });
    },
  });

  if (isLoading) {
    return <Skeleton active />;
  }

  return (
    <FormProvider {...form}>
      <FormJsonTabs
        preparePayload={prepareResourceFormPayload}
        form={form}
        onSubmit={(d) => putService.mutateAsync(d)}
        submitLabel="Save"
        rawData={serviceData?.value}
        adminApi={`${API_SERVICES}/${id}`}
        overviewReferenceContext={{ resourceType: 'service', resourceId: id }}
        detailTabs={[
          {
            key: 'references',
            label: 'References',
            children: <ReverseReferences resourceType="service" resourceId={id} />,
          },
        ]}
      >
        <FormSectionGeneral readOnly />
        <FormPartService showID={false} />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  const { id } = useParams({ from: '/services/detail/$id' });
  const navigate = useNavigate();
  const { data: serviceData } = useSuspenseQuery(getServiceQueryOptions(id));

  return (
    <>
      <PageHeader showBackBtn
        title={`Service: ${serviceData.value.name || id}`}
        desc={`ID: ${id} - Reusable policy layer between Routes and the downstream Upstream.`}
        extra={(
          <Space wrap>
            <ConfigurationImpact api={`${API_SERVICES}/${id}`} />
            <Link to="/routes/add" search={{ service_id: id }}>
              <Button size="small">+ Route</Button>
            </Link>
            <Link to="/services/add" search={{ clone_from: id }}>
              <Button size="small">Clone</Button>
            </Link>
            <DeleteResourceBtn
              mode="detail"
              name="Service"
              target={id}
              api={`${API_SERVICES}/${id}`}
              onSuccess={() => navigate({ to: '/services' })}
            />
          </Space>
        )}
      />
      <FormTOCBox>
        <ServiceDetailForm />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/services/detail/$id/')({
  component: RouteComponent,
});
