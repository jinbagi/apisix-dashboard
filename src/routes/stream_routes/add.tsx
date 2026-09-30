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
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { FormProvider, useForm } from 'react-hook-form';

import { postStreamRouteReq } from '@/apis/stream_routes';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormPartStreamRoute } from '@/components/form-slice/FormPartStreamRoute';
import {
  StreamRoutePostSchema,
  type StreamRoutePostType,
} from '@/components/form-slice/FormPartStreamRoute/schema';
import { FormTOCBox } from '@/components/form-slice/FormSection';
import PageHeader from '@/components/page/PageHeader';
import { StreamRoutesErrorComponent } from '@/components/page-slice/stream_routes/ErrorComponent';
import { API_STREAM_ROUTES } from '@/config/constant';
import { req } from '@/config/req';
import type { APISIXType } from '@/types/schema/apisix';
import { verifyAdminApiResource } from '@/utils/adminApiVerification';
import { stripSystemReadonlyFields } from '@/utils/apisixEditable';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

type Props = {
  navigate: (res: APISIXType['RespStreamRouteDetail']) => Promise<void>;
  defaultValues?: Partial<StreamRoutePostType>;
};

export const StreamRouteAddForm = (props: Props) => {
  const { navigate, defaultValues } = props;

  const postStreamRoute = useMutation({
    mutationFn: async (d: StreamRoutePostType) => {
      const payload = prepareResourceFormPayload(d);
      const response = await postStreamRouteReq(req, payload);
      const id = response.data.value.id;
      await verifyAdminApiResource(
        `${API_STREAM_ROUTES}/${id}`,
        stripSystemReadonlyFields(payload as Record<string, unknown>)
      );
      return response;
    },
    async onSuccess(response) {
      await refreshResourceCaches('stream_routes', API_STREAM_ROUTES);
      showNotification({
        message: 'Stream Route created and verified',
        type: 'success',
      });
      try {
        await navigate(response);
      } catch {
        showNotification({
          message:
            'Stream Route was created, but its detail page could not be opened automatically.',
          type: 'warning',
        });
      }
    },
  });

  const form = useForm({
    resolver: zodResolver(StreamRoutePostSchema, undefined, { raw: true }),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    defaultValues,
  });

  return (
    <FormProvider {...form}>
      <FormJsonTabs preparePayload={prepareResourceFormPayload} form={form} onSubmit={(d) => postStreamRoute.mutateAsync(d)} schema={StreamRoutePostSchema} submitLabel="Add">
        <FormPartStreamRoute />
      </FormJsonTabs>
    </FormProvider>
  );
};

function RouteComponent() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader showBackBtn
        title={`Add ${'Stream Route'}`}
      />
      <FormTOCBox>
        <StreamRouteAddForm
          navigate={(res) =>
            navigate({
              to: '/stream_routes/detail/$id',
              params: { id: res.data.value.id },
            })
          }
        />
      </FormTOCBox>
    </>
  );
}

export const Route = createFileRoute('/stream_routes/add')({
  component: RouteComponent,
  errorComponent: StreamRoutesErrorComponent,
});
