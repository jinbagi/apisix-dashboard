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
import {
  queryOptions,
  useMutation,
  useSuspenseQuery,
} from '@tanstack/react-query';
import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { Button, Skeleton, Space } from 'antd';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useBoolean } from 'react-use';

import { getUpstreamReq, putUpstreamReq } from '@/apis/upstreams';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartUpstream } from '@/components/form-slice/FormPartUpstream';
import { FormPartUpstreamSchema } from '@/components/form-slice/FormPartUpstream/schema';
import { produceToUpstreamForm } from '@/components/form-slice/FormPartUpstream/util';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { ConfigurationImpact } from '@/components/page/ConfigurationImpact';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { ReverseReferences } from '@/components/page/ReverseReferences';
import { API_UPSTREAMS } from '@/config/constant';
import { req } from '@/config/req';
import type { APISIXType } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { prepareUpstreamFormPayload } from '@/utils/resourceFormPayload';

type Props = {
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
};

const getUpstreamQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['upstream', id],
    queryFn: () => getUpstreamReq(req, id),
  });

const UpstreamDetailForm = (
  props: Props & Pick<APISIXType['Upstream'], 'id'>
) => {
  const { id, readOnly } = props;
  const {
    data: { value: upstreamData },
    isLoading,
    refetch,
  } = useSuspenseQuery(getUpstreamQueryOptions(id));

  const form = useForm({
    resolver: zodResolver(FormPartUpstreamSchema, undefined, { raw: true }),
    shouldUnregister: false,
    mode: 'all',
    disabled: readOnly,
  });

  const putUpstream = useMutation({
    mutationFn: (d: APISIXType['Upstream']) => putUpstreamReq(req, d),
    async onSuccess() {
      await refetch({ throwOnError: true });
      await refreshResourceCaches('upstreams', API_UPSTREAMS);
      showNotification({
        message: 'Upstream saved and reloaded from APISIX',
        type: 'success',
      });
    },
  });

  useEffect(() => {
    if (upstreamData && !isLoading) {
      form.reset(produceToUpstreamForm(upstreamData));
    }
  }, [upstreamData, form, isLoading]);

  if (isLoading) {
    return <Skeleton active />;
  }

  return (
    <FormProvider {...form}>
      <FormJsonTabs
        preparePayload={prepareUpstreamFormPayload}
        form={form}
        onSubmit={(d) => putUpstream.mutateAsync(prepareUpstreamFormPayload(d))}
        submitLabel="Save"
        disabled={readOnly}
        rawData={upstreamData}
        adminApi={`${API_UPSTREAMS}/${id}`}
        overviewReferenceContext={{ resourceType: 'upstream', resourceId: id }}
        detailTabs={[
          {
            key: 'references',
            label: 'References',
            children: <ReverseReferences resourceType="upstream" resourceId={id} />,
          },
        ]}
      >
        <FormSectionGeneral readOnly />
        <FormPartUpstream showID={false} />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  const { id } = useParams({ from: '/upstreams/detail/$id' });
  const [readOnly, setReadOnly] = useBoolean(false);
  const navigate = useNavigate();
  const {
    data: { value: upstream },
  } = useSuspenseQuery(getUpstreamQueryOptions(id));

  return (
    <>
      <PageHeader showBackBtn
        title={`Upstream: ${upstream.name || id}`}
        desc={`ID: ${id} - Backend selection, load-balancing, connection, and health policy.`}
        extra={(
          <Space wrap>
            <ConfigurationImpact api={`${API_UPSTREAMS}/${id}`} />
            <Link to="/services/add" search={{ upstream_id: id }}>
              <Button size="small">+ Service</Button>
            </Link>
            <Link to="/upstreams/add" search={{ clone_from: id }}>
              <Button size="small">Clone</Button>
            </Link>
            <DeleteResourceBtn
              mode="detail"
              name="Upstream"
              target={id}
              api={`${API_UPSTREAMS}/${id}`}
              onSuccess={() => navigate({ to: '/upstreams' })}
            />
          </Space>
        )}
      />
      <FormTOCBox>
        <UpstreamDetailForm
          id={id}
          readOnly={readOnly}
          setReadOnly={setReadOnly}
        />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/upstreams/detail/$id')({
  component: RouteComponent,
});
