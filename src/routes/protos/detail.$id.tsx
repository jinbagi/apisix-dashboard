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

import { getProtoQueryOptions } from '@/apis/hooks';
import { putProtoReq } from '@/apis/protos';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartProto } from '@/components/form-slice/FormPartProto';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { API_PROTOS } from '@/config/constant';
import { req } from '@/config/req';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

type ProtoFormProps = {
  id: string;
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
};

const ProtoDetailForm = ({ id, readOnly }: ProtoFormProps) => {
  const {
    data: protoData,
    isLoading,
    refetch,
  } = useSuspenseQuery(getProtoQueryOptions(id));

  const form = useForm<APISIXType['Proto']>({
    resolver: zodResolver(APISIX.Proto, undefined, { raw: true }),
    shouldUnregister: false,
    mode: 'all',
    disabled: readOnly,
  });

  const putProto = useMutation({
    mutationFn: (d: APISIXType['Proto']) => putProtoReq(req, prepareResourceFormPayload(d)),
    async onSuccess() {
      await refetch({ throwOnError: true });
      showNotification({
        message: 'Proto saved and reloaded from APISIX',
        type: 'success',
      });
    },
  });

  // Update form values when data is loaded
  useEffect(() => {
    if (protoData?.value) {
      form.reset(protoData.value);
    }
  }, [protoData, form]);

  if (isLoading) {
    return <Skeleton active />;
  }

  return (
    <FormProvider {...form}>
      <FormJsonTabs
        preparePayload={prepareResourceFormPayload}
        form={form}
        onSubmit={(d) => putProto.mutateAsync(d)}
        submitLabel="Save"
        disabled={readOnly}
        rawData={protoData?.value}
        adminApi={`${API_PROTOS}/${id}`}
      >
        <FormSectionGeneral readOnly />
        <FormPartProto allowUpload={!readOnly} />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  const { id } = useParams({ from: '/protos/detail/$id' });
  const [readOnly, setReadOnly] = useBoolean(false);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader showBackBtn
        title={`Proto: ${id}`}
        extra={(
          <Space>
            <DeleteResourceBtn
              mode="detail"
              name="Proto"
              target={id}
              api={`${API_PROTOS}/${id}`}
              onSuccess={() => navigate({ to: '/protos' })}
            />
          </Space>
        )}
      />
      <FormTOCBox>
        <ProtoDetailForm
          id={id}
          readOnly={readOnly}
          setReadOnly={setReadOnly}
        />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/protos/detail/$id')({
  component: RouteComponent,
});
