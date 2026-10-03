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
import { useBoolean } from 'react-use';

import { putConsumerReq } from '@/apis/consumers';
import { getConsumerQueryOptions } from '@/apis/hooks';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartConsumer } from '@/components/form-slice/FormPartConsumer';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { API_CONSUMERS } from '@/config/constant';
import { req } from '@/config/req';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

type Props = {
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
};

const ConsumerDetailForm = (props: Props) => {
  const { readOnly } = props;
  const { username } = useParams({ from: '/consumers/detail/$username' });

  const consumerQuery = useSuspenseQuery(getConsumerQueryOptions(username));
  const { data: consumerData, isLoading, refetch } = consumerQuery;

  const form = useForm({
    resolver: zodResolver(APISIX.ConsumerPut, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    disabled: readOnly,
  });

  useEffect(() => {
    if (consumerData?.value && !isLoading) {
      form.reset(consumerData.value);
    }
  }, [consumerData, form, isLoading]);

  const putConsumer = useMutation({
    mutationFn: (d: APISIXType['ConsumerPut']) => putConsumerReq(req, d),
    async onSuccess() {
      await refetch({ throwOnError: true });
      await refreshResourceCaches('consumers', API_CONSUMERS);
      showNotification({
        message: 'Consumer saved and reloaded from APISIX',
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
        onSubmit={(d) => putConsumer.mutateAsync(prepareResourceFormPayload(d))}
        submitLabel="Save"
        disabled={readOnly}
        rawData={consumerData?.value}
        adminApi={`${API_CONSUMERS}/${username}`}
      >
        <FormSectionGeneral showID={false} readOnly />
        <FormPartConsumer />
      </FormJsonTabs>
    </FormProvider>
  );
};

const ConsumerDetailTab = () => {
  const [readOnly, setReadOnly] = useBoolean(false);
  const { username } = useParams({ from: '/consumers/detail/$username' });
  const navigate = useNavigate();

  return (
    <>
      <PageHeader showBackBtn
        title={`Consumer: ${username}`}
        extra={(
          <Space>
            <DeleteResourceBtn
              mode="detail"
              name="Consumer"
              target={username}
              api={`${API_CONSUMERS}/${username}`}
              onSuccess={() => navigate({ to: '/consumers' })}
            />
          </Space>
        )}
      />
      <FormTOCBox>
        <ConsumerDetailForm readOnly={readOnly} setReadOnly={setReadOnly} />
      </FormTOCBox>
    </>
  );
};


export const Route = createFileRoute('/consumers/detail/$username/')({
  component: ConsumerDetailTab,
});
