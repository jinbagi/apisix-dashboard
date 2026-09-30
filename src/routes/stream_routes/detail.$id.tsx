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

import { getStreamRouteQueryOptions } from '@/apis/hooks';
import { putStreamRouteReq } from '@/apis/stream_routes';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartStreamRoute } from '@/components/form-slice/FormPartStreamRoute';
import { StreamRoutePutSchema } from '@/components/form-slice/FormPartStreamRoute/schema';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { StreamRoutesErrorComponent } from '@/components/page-slice/stream_routes/ErrorComponent';
import { API_STREAM_ROUTES } from '@/config/constant';
import { req } from '@/config/req';
import type { APISIXType } from '@/types/schema/apisix';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

type Props = {
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
  id: string;
};

const StreamRouteDetailForm = (props: Props) => {
  const { readOnly, id } = props;

  const streamRouteQuery = useSuspenseQuery(getStreamRouteQueryOptions(id));
  const { data: streamRouteData, refetch } = streamRouteQuery;

  const form = useForm({
    resolver: zodResolver(StreamRoutePutSchema, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    disabled: readOnly,
  });

  useEffect(() => {
    if (streamRouteData.value) {
      form.reset(streamRouteData.value);
    }
  }, [streamRouteData, form]);

  const putStreamRoute = useMutation({
    mutationFn: (d: APISIXType['StreamRoute']) =>
      putStreamRouteReq(req, prepareResourceFormPayload(d)),
    async onSuccess() {
      await refetch({ throwOnError: true });
      await refreshResourceCaches('stream_routes', API_STREAM_ROUTES);
      showNotification({
        message: 'Stream Route saved and reloaded from APISIX',
        type: 'success',
      });
    },
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs
        preparePayload={prepareResourceFormPayload}
        form={form}
        onSubmit={(d) => putStreamRoute.mutateAsync(d)}
        submitLabel="Save"
        disabled={readOnly}
        rawData={streamRouteData?.value}
        adminApi={`${API_STREAM_ROUTES}/${id}`}
      >
        <FormSectionGeneral readOnly />
        <FormPartStreamRoute showID={false} />
      </FormJsonTabs>
    </FormProvider>
  );
};

type StreamRouteDetailProps = Pick<Props, 'id'> & {
  onDeleteSuccess: () => void;
};

export const StreamRouteDetail = (props: StreamRouteDetailProps) => {
  const { id, onDeleteSuccess } = props;
  const [readOnly, setReadOnly] = useBoolean(false);

  return (
    <>
      <PageHeader showBackBtn
        title={`Stream Route: ${id}`}
        extra={(
          <Space>
            <DeleteResourceBtn
              mode="detail"
              name="Stream Route"
              target={id}
              api={`${API_STREAM_ROUTES}/${id}`}
              onSuccess={onDeleteSuccess}
            />
          </Space>
        )}
      />
      <FormTOCBox>
        <StreamRouteDetailForm
          readOnly={readOnly}
          setReadOnly={setReadOnly}
          id={id}
        />
      </FormTOCBox>
    </>
  );
};

function RouteComponent() {
  const { id } = useParams({ from: '/stream_routes/detail/$id' });
  const navigate = useNavigate();
  return (
    <StreamRouteDetail
      id={id}
      onDeleteSuccess={() => navigate({ to: '/stream_routes' })}
    />
  );
}

export const Route = createFileRoute('/stream_routes/detail/$id')({
  component: RouteComponent,
  errorComponent: StreamRoutesErrorComponent,
});
