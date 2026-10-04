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
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import { graphqlCostDecorationsApi, saveGraphqlCostDecoration } from '@/apis/graphql_cost_decorations';
import { formHistoryReq } from '@/apis/tracked-resource-write';
import { FormJsonTabs } from '@/components/form/FormJsonTabs';
import { FormItemNumberInput } from '@/components/form/NumberInput';
import { FormItemTagsInput } from '@/components/form/TagInput';
import { FormItemTextInput } from '@/components/form/TextInput';
import { queryClient } from '@/config/global';
import { GraphqlCostDecorationForm, type GraphqlCostDecorationType } from '@/types/schema/apisix/graphql_cost_decorations';
import { showNotification } from '@/utils/notification';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { prepareResourceFormPayload } from '@/utils/resourceFormPayload';

import { FormPartBasic } from './FormPartBasic';
import { FormSection } from './FormSection';

export const GraphqlCostDecorationEditor = ({ serviceId, initialData }: { serviceId: string; initialData?: GraphqlCostDecorationType }) => {
  const router = useRouter();
  const form = useForm<GraphqlCostDecorationType>({
    resolver: zodResolver(GraphqlCostDecorationForm, undefined, { raw: true }),
    defaultValues: initialData,
    shouldUnregister: false,
    mode: 'all',
  });
  const [baseline, setBaseline] = useState(initialData);
  const isDirty = form.formState.isDirty;
  useEffect(() => {
    if (initialData && !isDirty) {
      form.reset(initialData);
      setBaseline(initialData);
    }
  }, [form, initialData, isDirty]);
  const save = useMutation({
    mutationFn: async (data: GraphqlCostDecorationType) => {
      const payload = prepareResourceFormPayload({ ...data, ...(initialData?.id ? { id: initialData.id } : {}) });
      const response = await saveGraphqlCostDecoration(formHistoryReq, serviceId, payload);
      const id = String(response.data.value.id);
      await refreshResourceCaches(['graphql_cost_decorations', serviceId], graphqlCostDecorationsApi(serviceId));
      queryClient.setQueryData(['graphql_cost_decoration', serviceId, id], response.data);
      form.reset(response.data.value);
      return id;
    },
    async onSuccess() {
      showNotification({ message: 'GraphQL cost decoration saved and verified', type: 'success' });
      if (!initialData) {
        await router.navigate({ to: '/services/detail/$id/graphql_cost_decorations', params: { id: serviceId } });
      }
    },
  });
  return (
    <FormProvider {...form}>
      <FormJsonTabs form={form} schema={GraphqlCostDecorationForm} preparePayload={prepareResourceFormPayload}
        rawData={baseline} onSubmit={(data) => save.mutateAsync(data)} submitLabel={initialData ? 'Save' : 'Add'}>
        <FormPartBasic showID={!initialData} />
        <FormSection legend="GraphQL Query Cost">
          <FormItemTextInput control={form.control} name="field_path" label="Field Path" required
            description="GraphQL type or field path, for example Query.products. Each path must be unique within this Service." />
          <FormItemNumberInput control={form.control} name="add_value" label="Add Value" min={0}
            description="This field's own cost. APISIX defaults to 1." />
          <FormItemTagsInput control={form.control} name="add_arguments" label="Add Arguments"
            description="Query argument values added to this field's own cost." />
          <FormItemNumberInput control={form.control} name="mul_value" label="Multiply Value" min={0}
            description="Multiplier for the cost of selected child fields. APISIX defaults to 1." />
          <FormItemTagsInput control={form.control} name="mul_arguments" label="Multiply Arguments"
            description="Pagination arguments such as first or limit that multiply child cost." />
        </FormSection>
      </FormJsonTabs>
    </FormProvider>
  );
};
