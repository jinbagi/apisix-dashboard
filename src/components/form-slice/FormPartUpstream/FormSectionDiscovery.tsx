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
import { Alert } from 'antd';
import { useFormContext, useWatch } from 'react-hook-form';

import { FormItemJsonInput } from '@/components/form/JsonInput';
import { FormItemSelect } from '@/components/form/Select';
import { useNamePrefix } from '@/utils/useNamePrefix';

import { FormItemTextInput } from '../../form/TextInput';
import { FormSection } from '../FormSection';
import type { FormPartUpstreamType } from './schema';

const DISCOVERY_TYPES = [
  'dns',
  'consul',
  'consul_kv',
  'eureka',
  'kubernetes',
  'nacos',
  'tars',
];

export const FormSectionDiscovery = () => {
  const { control } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  const serviceName = useWatch({ control, name: np('service_name') });
  const discoveryType = useWatch({ control, name: np('discovery_type') });
  const discoveryArgs = useWatch({ control, name: np('discovery_args') });
  const hasServiceName = typeof serviceName === 'string' && serviceName.trim().length > 0;
  const hasDiscoveryType = typeof discoveryType === 'string' && discoveryType.trim().length > 0;
  const hasDiscoveryArgs =
    !!discoveryArgs &&
    typeof discoveryArgs === 'object' &&
    Object.keys(discoveryArgs).length > 0;

  return (
    <FormSection legend="Service Discovery">
      <Alert
        type="info"
        showIcon
        title="Use Service Discovery instead of static nodes when APISIX should resolve backend targets dynamically."
        description="Service Name and Discovery Type should be set together. Discovery Args are optional provider-specific settings."
        style={{ marginBottom: 12 }}
      />
      {hasServiceName && !hasDiscoveryType && (
        <Alert
          type="warning"
          showIcon
          title="Discovery Type is missing."
          description="Select the discovery provider that should resolve this service name."
          style={{ marginBottom: 12 }}
        />
      )}
      {!hasServiceName && hasDiscoveryArgs && (
        <Alert
          type="warning"
          showIcon
          title="Discovery Args are set without a Service Name."
          description="Add a Service Name or clear Discovery Args so the discovery configuration has an active target."
          style={{ marginBottom: 12 }}
        />
      )}
      <FormItemTextInput
        name={np('service_name')}
        label="Service Name"
        control={control}
        required={hasDiscoveryType}
        description="Name resolved by the selected discovery provider."
      />
      <FormItemSelect
        name={np('discovery_type')}
        label="Discovery Type"
        control={control}
        required={hasServiceName}
        data={DISCOVERY_TYPES}
        clearable
        searchable
        description="Provider used to resolve Service Name."
      />
      <FormItemJsonInput
        name={np('discovery_args')}
        label="Discovery Args"
        control={control}
        toObject
        description="Optional JSON object passed to the selected discovery provider."
      />
    </FormSection>
  );
};
