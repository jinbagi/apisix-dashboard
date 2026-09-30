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
import { Space } from 'antd';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useBoolean } from 'react-use';

import { getSecretQueryOptions } from '@/apis/hooks';
import { putSecretReq } from '@/apis/secrets';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartSecret } from '@/components/form-slice/FormPartSecret';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { API_SECRETS } from '@/config/constant';
import { req } from '@/config/req';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

type Props = {
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
};

const SecretDetailForm = (props: Props) => {
  const { readOnly } = props;
  const { manager, id } = useParams({ from: '/secrets/detail/$manager/$id' });

  const secretQuery = useSuspenseQuery(
    getSecretQueryOptions({
      id,
      manager: manager as APISIXType['Secret']['manager'],
    })
  );
  const { data: secretData, refetch } = secretQuery;

  const form = useForm({
    resolver: zodResolver(APISIX.Secret, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    disabled: readOnly,
  });

  useEffect(() => {
    if (secretData.value) {
      form.reset(secretData.value);
    }
    // readonly is used as a dep to ensure that it can be reset correctly when switching states.
  }, [secretData, form, readOnly]);

  const putSecret = useMutation({
    mutationFn: (d: APISIXType['Secret']) =>
      putSecretReq(req, prepareResourceFormPayload(d)),
    async onSuccess() {
      await refetch({ throwOnError: true });
      showNotification({
        message: 'Secret saved and reloaded from APISIX',
        type: 'success',
      });
    },
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs
        preparePayload={prepareResourceFormPayload}
        form={form}
        onSubmit={(d) => putSecret.mutateAsync(d)}
        submitLabel="Save"
        disabled={readOnly}
        rawData={secretData.value}
        adminApi={`${API_SECRETS}/${manager}/${id}`}
      >
        <FormSectionGeneral readOnly />
        <FormPartSecret readOnlyManager />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  const [readOnly, setReadOnly] = useBoolean(false);
  const { manager, id } = useParams({ from: '/secrets/detail/$manager/$id' });
  const navigate = useNavigate();

  return (
    <>
      <PageHeader showBackBtn
        title={`Secret: ${manager}/${id}`}
        extra={(
          <Space>
            <DeleteResourceBtn
              mode="detail"
              name="Secret"
              target={id}
              api={`${API_SECRETS}/${manager}/${id}`}
              onSuccess={() => navigate({ to: '/secrets' })}
            />
          </Space>
        )}
      />
      <FormTOCBox>
        <SecretDetailForm readOnly={readOnly} setReadOnly={setReadOnly} />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/secrets/detail/$manager/$id')({
  component: RouteComponent,
});
