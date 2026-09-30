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

import { putConsumerGroupReq } from '@/apis/consumer_groups';
import { getConsumerGroupQueryOptions } from '@/apis/hooks';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartPluginConfig } from '@/components/form-slice/FormPartPluginConfig';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { API_CONSUMER_GROUPS } from '@/config/constant';
import { req } from '@/config/req';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

type Props = {
  id: string;
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
};

const ConsumerGroupDetailForm = (props: Props) => {
  const { id, readOnly } = props;

  const consumerGroupQuery = useSuspenseQuery(getConsumerGroupQueryOptions(id));
  const { data } = consumerGroupQuery;

  const putConsumerGroup = useMutation({
    mutationFn: (d: APISIXType['ConsumerGroupPut']) =>
      putConsumerGroupReq(req, d),
    async onSuccess() {
      await consumerGroupQuery.refetch({ throwOnError: true });
      await refreshResourceCaches('consumer_groups', API_CONSUMER_GROUPS);
      showNotification({
        message: 'Consumer Group saved and reloaded from APISIX',
        type: 'success',
      });
    },
  });

  const form = useForm({
    resolver: zodResolver(APISIX.ConsumerGroupPut, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    disabled: readOnly,
  });

  useEffect(() => {
    form.reset(data.value);
  }, [form, data.value]);

  if (!data) return <Skeleton active />;

  return (
    <FormProvider {...form}>
      <FormJsonTabs
        preparePayload={prepareResourceFormPayload}
        form={form}
        onSubmit={(d) => putConsumerGroup.mutateAsync(prepareResourceFormPayload({ ...d, id }))}
        submitLabel="Save"
        disabled={readOnly}
        rawData={data?.value}
        adminApi={`${API_CONSUMER_GROUPS}/${id}`}
      >
        <FormSectionGeneral readOnly />
        <FormPartPluginConfig basicProps={{}} />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  const { id } = useParams({ from: '/consumer_groups/detail/$id' });
  const [readOnly, setReadOnly] = useBoolean(false);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader showBackBtn
        title={`Consumer Group: ${id}`}
        extra={(
          <Space>
            <DeleteResourceBtn
              mode="detail"
              name="Consumer Group"
              target={id}
              api={`${API_CONSUMER_GROUPS}/${id}`}
              onSuccess={() => navigate({ to: '/consumer_groups' })}
            />
          </Space>
        )}
      />
      <FormTOCBox>
        <ConsumerGroupDetailForm
          id={id}
          readOnly={readOnly}
          setReadOnly={setReadOnly}
        />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/consumer_groups/detail/$id')({
  component: RouteComponent,
});
