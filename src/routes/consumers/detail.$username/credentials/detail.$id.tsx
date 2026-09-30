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

import { putCredentialReq } from '@/apis/credentials';
import { getCredentialQueryOptions } from '@/apis/hooks';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartCredential } from '@/components/form-slice/FormPartCredential';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { API_CREDENTIALS } from '@/config/constant';
import { req } from '@/config/req';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

type CredentialFormProps = {
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
};

const CredentialDetailForm = (props: CredentialFormProps) => {
  const { readOnly } = props;
  const { username, id } = useParams({
    from: '/consumers/detail/$username/credentials/detail/$id',
  });

  const {
    data: credentialData,
    isLoading,
    refetch,
  } = useSuspenseQuery(getCredentialQueryOptions(username, id));

  const form = useForm({
    resolver: zodResolver(APISIX.CredentialPut, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    disabled: readOnly,
  });

  useEffect(() => {
    if (credentialData?.value && !isLoading) {
      form.reset(credentialData.value);
    }
  }, [credentialData, form, isLoading]);

  const putCredential = useMutation({
    mutationFn: (d: APISIXType['CredentialPut']) =>
      putCredentialReq(req, prepareResourceFormPayload({ ...d, username })),
    async onSuccess() {
      await refetch({ throwOnError: true });
      showNotification({
        message: 'Credential saved and reloaded from APISIX',
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
        onSubmit={(d) => putCredential.mutateAsync(d)}
        submitLabel="Save"
        disabled={readOnly}
        rawData={credentialData?.value}
        adminApi={`${API_CREDENTIALS(username)}/${id}`}
      >
        <FormSectionGeneral readOnly />
        <FormPartCredential />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  const [readOnly, setReadOnly] = useBoolean(false);
  const { username, id } = useParams({
    from: '/consumers/detail/$username/credentials/detail/$id',
  });
  const navigate = useNavigate();

  return (
    <>
      <PageHeader showBackBtn
        title={`${'Credential'} Detail`}
        extra={(
          <Space>
            <DeleteResourceBtn
              mode="detail"
              key="delete"
              name="Credential"
              target={id}
              api={`${API_CREDENTIALS(username)}/${id}`}
              onSuccess={() =>
                navigate({ to: `/consumers/detail/${username}/credentials` })
              }
            />
          </Space>
        )}
      />
      <FormTOCBox>
        <CredentialDetailForm readOnly={readOnly} setReadOnly={setReadOnly} />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute(
  '/consumers/detail/$username/credentials/detail/$id'
)({
  component: RouteComponent,
});
