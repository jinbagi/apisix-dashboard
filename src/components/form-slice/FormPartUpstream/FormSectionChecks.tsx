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
import { theme,Typography } from 'antd';
import { useEffect } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { FormItemLabels } from '@/components/form/Labels';
import { FormItemNumberInput } from '@/components/form/NumberInput';
import { FormItemSelect } from '@/components/form/Select';
import { FormItemSwitch } from '@/components/form/Switch';
import { FormItemTagsInput } from '@/components/form/TagInput';
import { FormItemTextInput } from '@/components/form/TextInput';
import { APISIX } from '@/types/schema/apisix';
import { useNamePrefix } from '@/utils/useNamePrefix';

import { FormSection } from '../FormSection';
import type { FormPartUpstreamType } from './schema';

const FormSectionChecksActive = () => {
  const { control } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  return (
    <FormSection legend="Active">
      <FormItemSwitch
        control={control}
        name={np('checks.active.https_verify_certificate')}
        label="Https Verify Certificate"
      />
      <FormItemSelect
        control={control}
        name={np('checks.active.type')}
        defaultValue={APISIX.UpstreamHealthCheckActiveType.options[0].value}
        label="Type"
        data={APISIX.UpstreamHealthCheckActiveType.options.map((v) => v.value)}
      />
      <FormItemNumberInput
        control={control}
        name={np('checks.active.timeout')}
        label="Timeout"
        suffix="s"
        description="Timeout in seconds for the probe request. Default: 1."
      />
      <FormItemNumberInput
        control={control}
        name={np('checks.active.concurrency')}
        label="Concurrency"
        allowDecimal={false}
        description="Number of targets to check concurrently in active checks. Default: 10."
      />
      <FormItemTextInput
        control={control}
        name={np('checks.active.host')}
        label="Host"
        description="Host header for the probe request. Defaults to the upstream node host."
      />
      <FormItemNumberInput
        control={control}
        name={np('checks.active.port')}
        label="Port"
        allowDecimal={false}
        description="Port to use for probe requests. Defaults to the upstream node port."
      />
      <FormItemTextInput
        control={control}
        name={np('checks.active.http_path')}
        label="HTTP Path"
        description="The HTTP path for the probe request (e.g., /health). Default: /."
      />
      <FormItemSelect
        control={control}
        name={np('checks.active.method')}
        label="HTTP Method"
        defaultValue="GET"
        data={APISIX.UpstreamHealthCheckActiveMethod.options.map((v) => v.value)}
      />
      <FormItemLabels
        control={control}
        name={np('checks.active.http_request_headers')}
        label="HTTP Request Headers"
      />
      <FormSection legend="Healthy">
        <FormItemNumberInput
          control={control}
          name={np('checks.active.healthy.interval')}
          label="Interval"
          suffix="s"
          description="How often to run active health checks (seconds). Must be >= 1."
        />
        <FormItemNumberInput
          control={control}
          name={np('checks.active.healthy.successes')}
          label="Successes"
          allowDecimal={false}
          description="Number of consecutive successes to consider a target healthy. Range: 1-254. Default: 2."
        />
        <FormItemTagsInput
          control={control}
          name={np('checks.active.healthy.http_statuses')}
          label="HTTP Statuses"
          from={String}
          to={Number}
        />
      </FormSection>
      <FormSection legend="Unhealthy">
        <FormItemNumberInput
          control={control}
          name={np('checks.active.unhealthy.interval')}
          label="Interval"
          suffix="s"
          description="How often to run unhealthy checks (seconds). Must be >= 1."
        />
        <FormItemNumberInput
          control={control}
          name={np('checks.active.unhealthy.http_failures')}
          label="HTTP Failures"
          allowDecimal={false}
          description="Number of HTTP failures to consider a target unhealthy. Range: 1-254. Default: 5."
        />
        <FormItemNumberInput
          control={control}
          name={np('checks.active.unhealthy.tcp_failures')}
          label="TCP Failures"
          allowDecimal={false}
          description="Number of TCP connection failures to consider a target unhealthy. Range: 1-254. Default: 2."
        />
        <FormItemNumberInput
          control={control}
          name={np('checks.active.unhealthy.timeouts')}
          label="Timeouts"
          allowDecimal={false}
          description="Number of timeouts to consider a target unhealthy. Range: 1-254. Default: 3."
        />
        <FormItemTagsInput
          control={control}
          name={np('checks.active.unhealthy.http_statuses')}
          label="HTTP Statuses"
          from={String}
          to={Number}
        />
      </FormSection>
    </FormSection>
  );
};

const FormItemChecksPassiveEnabled = () => {
  const { control, unregister, setValue } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  return (
    <FormItemSwitch
      onChange={(enabled) => {
        if (!enabled) {
          unregister(np('checks.passive'));
          setValue(np('checks.passive'), undefined, { shouldDirty: true });
        }
      }}
      control={control}
      name="__checksPassiveEnabled"
      data-testid="checksPassiveEnabled"
      shouldUnregister={false}
      aria-label="Enable passive health checks"
    />
  );
};
const FormSectionChecksPassiveCore = () => {
  const { control, formState } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  const { token } = theme.useToken();
  const passiveEnabled = useWatch({
    control,
    name: '__checksPassiveEnabled',
    defaultValue: formState.defaultValues?.__checksPassiveEnabled,
  });

  if (passiveEnabled) {
    return (
      <>
        <FormItemSelect
          control={control}
          name={np('checks.passive.type')}
          defaultValue={APISIX.UpstreamHealthCheckPassiveType.options[0].value}
          label="Type"
          data={APISIX.UpstreamHealthCheckPassiveType.options.map(
            (v) => v.value
          )}
        />

        <FormSection legend="Healthy">
          <FormItemNumberInput
            control={control}
            name={np('checks.passive.healthy.successes')}
            label="Successes"
            allowDecimal={false}
          />
          <FormItemTagsInput
            control={control}
            name={np('checks.passive.healthy.http_statuses')}
            label="HTTP Statuses"
            from={String}
            to={Number}
          />
        </FormSection>

        <FormSection legend="Unhealthy">
          <FormItemNumberInput
            control={control}
            name={np('checks.passive.unhealthy.http_failures')}
            label="HTTP Failures"
            allowDecimal={false}
          />
          <FormItemNumberInput
            control={control}
            name={np('checks.passive.unhealthy.tcp_failures')}
            label="TCP Failures"
            allowDecimal={false}
          />
          <FormItemNumberInput
            control={control}
            name={np('checks.passive.unhealthy.timeouts')}
            label="Timeouts"
            allowDecimal={false}
          />
          <FormItemTagsInput
            control={control}
            name={np('checks.passive.unhealthy.http_statuses')}
            label="HTTP Statuses"
            from={String}
            to={Number}
          />
        </FormSection>
      </>
    );
  }
  return (
    <Typography.Text style={{ color: token.colorTextSecondary, fontSize: 'var(--app-font-size-base)' }}>
      Disabled, click switch to enable
    </Typography.Text>
  );
};

const FormSectionChecksPassive = () => {
  return (
    <FormSection
      legend="Passive"
      extra={<FormItemChecksPassiveEnabled />}
    >
      <FormSectionChecksPassiveCore />
    </FormSection>
  );
};

const FormItemChecksEnabled = () => {
  const { control, unregister, setValue } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  return (
    <FormItemSwitch
      onChange={(enabled) => {
        if (!enabled) {
          unregister(np('checks'));
          setValue(np('checks'), undefined, { shouldDirty: true });
        }
      }}
      control={control}
      name="__checksEnabled"
      data-testid="checksEnabled"
      shouldUnregister={false}
      aria-label="Enable health checks"
    />
  );
};

const FormSectionChecksCore = () => {
  const { control, formState } = useFormContext<FormPartUpstreamType>();
  const { token } = theme.useToken();
  const enabled = useWatch({
    control,
    name: '__checksEnabled',
    defaultValue: formState.defaultValues?.__checksEnabled,
  });

  if (enabled) {
    return (
      <>
        <FormSectionChecksActive />
        <FormSectionChecksPassive />
      </>
    );
  }
  return (
    <Typography.Text style={{ color: token.colorTextSecondary, fontSize: 'var(--app-font-size-base)' }}>
      Disabled, click switch to enable
    </Typography.Text>
  );
};

export const FormSectionChecks = () => {
  const { control, setValue } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  const checks = useWatch({ control, name: np('checks') });
  const enabled = useWatch({ control, name: '__checksEnabled' });
  const passiveEnabled = useWatch({ control, name: '__checksPassiveEnabled' });
  useEffect(() => {
    if (enabled === undefined) setValue('__checksEnabled', !!checks);
    if (passiveEnabled === undefined) setValue('__checksPassiveEnabled', !!checks?.passive);
  }, [checks, enabled, passiveEnabled, setValue]);
  return (
    <FormSection
      legend="Health Checks"
      extra={<FormItemChecksEnabled />}
      collapsible
      defaultOpen
    >
      <FormSectionChecksCore />
    </FormSection>
  );
};
