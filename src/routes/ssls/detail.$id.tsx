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
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { Skeleton, Space } from 'antd';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import { getSSLQueryOptions } from '@/apis/hooks';
import { putSSLReq } from '@/apis/ssls';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartSSL } from '@/components/form-slice/FormPartSSL';
import {
  produceSSLSubmitPayload,
  produceToSSLForm,
  SSLPutSchema,
  type SSLPutType,
} from '@/components/form-slice/FormPartSSL/schema';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { StatusSwitch } from '@/components/StatusTag';
import { API_SSLS } from '@/config/constant';
import { req } from '@/config/req';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';

const SSLDetailForm = (props: { id: string }) => {
  const { id } = props;
  const {
    data: { value: sslData },
    isLoading,
    refetch,
  } = useSuspenseQuery(getSSLQueryOptions(id));

  const form = useForm({
    resolver: zodResolver(SSLPutSchema, undefined, { raw: true }),
    shouldUnregister: false,
    mode: 'all',
  });

  const putSSL = useMutation({
    mutationFn: (d: SSLPutType) => putSSLReq(req, produceSSLSubmitPayload(d)),
    async onSuccess() {
      await refetch({ throwOnError: true });
      await refreshResourceCaches('ssls', API_SSLS);
      showNotification({
        message: 'SSL saved and reloaded from APISIX',
        type: 'success',
      });
    },
  });

  useEffect(() => {
    if (sslData && !isLoading) {
      form.reset(produceToSSLForm(sslData));
    }
  }, [sslData, form, isLoading]);

  if (isLoading) {
    return <Skeleton active />;
  }

  return (
    <FormTOCBox>
      <FormProvider {...form}>
        <FormJsonTabs
          preparePayload={produceSSLSubmitPayload}
          form={form}
          onSubmit={(d) =>
            putSSL.mutateAsync(produceSSLSubmitPayload(d))
          }
          submitLabel="Save"
          rawData={sslData}
          adminApi={`${API_SSLS}/${id}`}
        >
          <FormSectionGeneral readOnly />
          <FormPartSSL showID={false} />
        </FormJsonTabs>
      </FormProvider>
    </FormTOCBox>
  );
};

function RouteComponent() {
  const { id } = useParams({ from: '/ssls/detail/$id' });
  const navigate = useNavigate();

  return (
    <>
      <PageHeader showBackBtn
        title={`SSL: ${id}`}
        extra={(
          <Space>
            <StatusSwitch api={`${API_SSLS}/${id}`} />
            <DeleteResourceBtn
              mode="detail"
              name="SSL"
              target={id}
              api={`${API_SSLS}/${id}`}
              onSuccess={() => navigate({ to: '/ssls' })}
            />
          </Space>
        )}
      />
      <SSLDetailForm id={id} />
    </>
  );
}

export const Route = createFileRoute('/ssls/detail/$id')({
  component: RouteComponent,
});
