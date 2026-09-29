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
import { Alert, Button, Collapse, Divider, Segmented } from 'antd';
import { useEffect, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { FormItemEditor } from '@/components/form/Editor';
import { InputWrapper } from '@/components/form/InputWrapper';
import { FormItemNumberInput } from '@/components/form/NumberInput';
import { ResourceSelect } from '@/components/form/ResourceSelect';
import { FormItemSwitch } from '@/components/form/Switch';
import { FormItemTagsInput } from '@/components/form/TagInput';
import { FormItemTextInput } from '@/components/form/TextInput';
import { API_PLUGIN_CONFIGS, API_SERVICES, API_UPSTREAMS } from '@/config/constant';
import { APISIX } from '@/types/schema/apisix';
import { NamePrefixProvider } from '@/utils/useNamePrefix';
import { zGetDefault } from '@/utils/zod';

import { useFormReadOnlyFields } from '../../../utils/form-context';
import { FormItemPlugins } from '../FormItemPlugins';
import { FormPartBasic } from '../FormPartBasic';
import { FormPartUpstream, FormSectionTimeout } from '../FormPartUpstream';
import { FormSection } from '../FormSection';
import {
  DependencyChoice,
  ResourceHierarchy,
} from '../ResourceHierarchy';
import { FormItemVars } from './FormItemVars';
import type { RoutePostType } from './schema';

const FormPartBasicWithPriority = ({ showID }: { showID: boolean }) => {
  const { control } = useFormContext<RoutePostType>();
  return (
    <FormPartBasic showID={showID} showStatus>
      <FormItemNumberInput
        control={control}
        name="priority"
        label="Priority"
        defaultValue={zGetDefault(APISIX.Route).priority!}
      />
    </FormPartBasic>
  );
};

const FormSectionMatchRules = () => {
  const { control, formState } = useFormContext<RoutePostType>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const vars = useWatch({ control, name: 'vars' });
  const filterFunc = useWatch({ control, name: 'filter_func' });
  useEffect(() => {
    if (vars?.length || filterFunc || formState.errors.vars || formState.errors.filter_func) setAdvancedOpen(true);
  }, [vars, filterFunc, formState.errors.vars, formState.errors.filter_func]);
  const uri = useWatch({ control, name: 'uri' });
  const uris = useWatch({ control, name: 'uris' });
  const host = useWatch({ control, name: 'host' });
  const hosts = useWatch({ control, name: 'hosts' });
  const remoteAddr = useWatch({ control, name: 'remote_addr' });
  const remoteAddrs = useWatch({ control, name: 'remote_addrs' });

  const hasUri = !!uri;
  const hasUris = Array.isArray(uris) && uris.length > 0;
  const hasHost = !!host;
  const hasHosts = Array.isArray(hosts) && hosts.length > 0;
  const hasRemoteAddr = !!remoteAddr;
  const hasRemoteAddrs = Array.isArray(remoteAddrs) && remoteAddrs.length > 0;

  return (
    <FormSection legend="Match Rules" collapsible defaultOpen={true}>
      <FormItemTagsInput
        control={control}
        name="methods"
        label="HTTP Methods"
        data={APISIX.HttpMethod.options.map((v) => v.value)}
        searchValue=""
      />
      <FormItemTextInput
        control={control}
        name="uri"
        label="URI"
        description="Single URI path. Disabled when URIs is set."
        required={!hasUris}
        disabled={hasUris && !hasUri}
      />
      <FormItemTagsInput
        control={control}
        name="uris"
        label="URIs"
        description="Multiple URI paths. Disabled when URI is set."
        required={!hasUri}
        disabled={hasUri && !hasUris}
      />
      <InputWrapper label="Enable WebSocket">
        <FormItemSwitch
          control={control}
          name="enable_websocket"
          aria-label="Enable WebSocket"
        />
      </InputWrapper>
      <FormItemTextInput
        control={control}
        name="host"
        label="Host"
        description="Single hostname. Disabled when Hosts is set."
        disabled={hasHosts && !hasHost}
      />
      <FormItemTagsInput
        control={control}
        name="hosts"
        label="Hosts"
        description="Multiple hostnames. Disabled when Host is set."
        disabled={hasHost && !hasHosts}
      />
      <FormItemTextInput
        control={control}
        name="remote_addr"
        label="Remote Address"
        description="Single IP/CIDR. Disabled when Remote Addresses is set."
        disabled={hasRemoteAddrs && !hasRemoteAddr}
      />
      <FormItemTagsInput
        control={control}
        name="remote_addrs"
        label="Remote Addresses"
        description="Multiple IPs/CIDRs. Disabled when Remote Address is set."
        disabled={hasRemoteAddr && !hasRemoteAddrs}
      />
      <Collapse
        activeKey={advancedOpen ? ['advanced-match'] : []}
        onChange={(keys) => setAdvancedOpen(keys.includes('advanced-match'))}
        ghost
        items={[
          {
            key: 'advanced-match',
            label: 'Advanced matching',
            forceRender: true,
            children: (
              <>
                <FormItemVars />
                <FormItemEditor
                  control={control}
                  name="filter_func"
                  label="Filter Func"
                  description="Optional Lua function for advanced request filtering. It must start with `function`."
                  language="lua"
                />
              </>
            ),
          },
        ]}
      />
    </FormSection>
  );
};

export const FormSectionUpstream = ({
  owner = 'route',
}: {
  owner?: 'route' | 'service';
}) => {
  const { control, setValue } = useFormContext<RoutePostType>();
  const readOnlyFields = useFormReadOnlyFields();
  const serviceId = useWatch({ control, name: 'service_id' });
  const upstreamId = useWatch({ control, name: 'upstream_id' });
  const inlineUpstream = useWatch({ control, name: 'upstream' });
  const inlineNodes = inlineUpstream?.nodes;
  const hasInlineNodes = Array.isArray(inlineNodes)
    ? inlineNodes.length > 0
    : !!inlineNodes && Object.keys(inlineNodes).length > 0;
  const hasInlineUpstream =
    hasInlineNodes ||
    !!inlineUpstream?.service_name ||
    !!inlineUpstream?.discovery_type;
  const resolvedThrough = serviceId
    ? 'service'
    : upstreamId
      ? 'upstream'
      : hasInlineUpstream
        ? 'inline-upstream'
        : undefined;
  type TargetMode = 'service' | 'upstream' | 'inline-upstream';
  const [targetMode, setTargetMode] = useState<TargetMode>(
    serviceId
      ? 'service'
      : upstreamId
        ? 'upstream'
        : hasInlineUpstream
          ? 'inline-upstream'
          : owner === 'route'
            ? 'service'
            : 'upstream'
  );

  useEffect(() => {
    if (serviceId) setTargetMode('service');
    else if (upstreamId) setTargetMode('upstream');
    else if (hasInlineUpstream) setTargetMode('inline-upstream');
  }, [hasInlineUpstream, serviceId, upstreamId]);

  const selectTargetMode = (next: TargetMode) => {
    setTargetMode(next);
    if (next === 'service') {
      setValue('upstream_id', undefined, { shouldDirty: true });
      setValue('upstream', undefined, { shouldDirty: true });
    } else if (next === 'upstream') {
      setValue('service_id', undefined, { shouldDirty: true });
      setValue('upstream', undefined, { shouldDirty: true });
    } else {
      setValue('service_id', undefined, { shouldDirty: true });
      setValue('upstream_id', undefined, { shouldDirty: true });
    }
  };

  const targetOptions = owner === 'route'
    ? [
        { label: 'Use Service', value: 'service' },
        { label: 'Use existing Upstream', value: 'upstream' },
        { label: 'Define inline Upstream', value: 'inline-upstream' },
      ]
    : [
        { label: 'Use existing Upstream', value: 'upstream' },
        { label: 'Define inline Upstream', value: 'inline-upstream' },
      ];

  return (
    <FormSection legend="Traffic Target" collapsible defaultOpen>
      <ResourceHierarchy
        current={owner}
        resolvedThrough={resolvedThrough}
      />
      <InputWrapper
        label="Target type"
        description="Choose the target to edit. Changing the target clears the previous selection."
      >
        <Segmented
          block
          value={targetMode}
          options={targetOptions}
          onChange={(value) => selectTargetMode(value as TargetMode)}
        />
      </InputWrapper>
      {serviceId && (
        <Alert
          type="info"
          showIcon
          message="Traffic resolves through the selected Service."
          description="Existing Route-level Upstream overrides are preserved on save. Use Admin API JSON to inspect or edit combined configurations."
          style={{ marginBottom: 12 }}
        />
      )}
      {!serviceId && upstreamId && (
        <Alert
          type="info"
          showIcon
          message="Upstream ID is set. Any existing inline configuration is preserved until you change the target."
          style={{ marginBottom: 12 }}
        />
      )}
      {owner === 'route' && (
        <>
          {targetMode === 'service' && (
            <div role="group" aria-label="Service target">
              <DependencyChoice
                step={1}
                title="Use a Service"
                description="Recommended when routes should share plugins, policies, or the same backend target."
                selected
              >
                <ResourceSelect
                  control={control}
                  name="service_id"
                  resourceApi={API_SERVICES}
                  resourceLabel="Service"
                  disabled={readOnlyFields.includes('service_id')}
                  description="Select the shared Service for this Route."
                />
              </DependencyChoice>
            </div>
          )}
        </>
      )}
      {targetMode === 'upstream' && (
        <div role="group" aria-label="Reusable Upstream target">
          <DependencyChoice
            step={1}
            title="Use a reusable Upstream"
            description="Reference an existing backend pool and load-balancing policy."
            selected
          >
            <ResourceSelect
              control={control}
              name="upstream_id"
              resourceApi={API_UPSTREAMS}
              resourceLabel="Upstream"
              description="Select the reusable backend pool for this resource."
            />
          </DependencyChoice>
        </div>
      )}
      {targetMode === 'inline-upstream' && (
        <div role="group" aria-label="Inline Upstream target">
          <DependencyChoice
            step={1}
            title="Define an inline Upstream"
            description={`Store backend nodes and connection policy inside this ${owner === 'route' ? 'Route' : 'Service'}.`}
            selected
            collapsible
            defaultOpen
          >
            <fieldset
              style={{ minWidth: 0, border: 0, margin: 0, padding: 0 }}
            >
              <NamePrefixProvider value="upstream">
                <FormPartUpstream showHierarchy={false} showID={false} />
              </NamePrefixProvider>
            </fieldset>
          </DependencyChoice>
        </div>
      )}
    </FormSection>
  );
};

export const FormSectionPlugins = (
  props: {
    showPluginConfig?: boolean;
    subsystem?: 'http' | 'stream';
  } = {}
) => {
  const { showPluginConfig = true, subsystem = 'http' } = props;
  const { control } = useFormContext<RoutePostType>();
  return (
    <FormSection legend="Plugins" collapsible defaultOpen>
      {showPluginConfig && (
        <div className="plugin-config-section">
          <ResourceSelect
            control={control}
            name="plugin_config_id"
            resourceApi={API_PLUGIN_CONFIGS}
            resourceLabel="Plugin Config"
          />
        </div>
      )}
      <FormItemPlugins name="plugins" subsystem={subsystem} />
    </FormSection>
  );
};

export const FormSectionScript = () => {
  const { control } = useFormContext<RoutePostType>();
  return (
    <FormSection legend="Script" collapsible defaultOpen>
      <FormItemTextInput
        control={control}
        name="script_id"
        label="Script ID"
      />
      <Divider style={{ margin: '8px 0' }}>OR</Divider>
      <FormItemEditor
        control={control}
        name="script"
        label="Script"
        language="lua"
      />
    </FormSection>
  );
};

const hasTimeoutValue = (timeout: RoutePostType['timeout']) =>
  !!timeout &&
  Object.values(timeout).some((value) => value !== undefined);

const FormSectionRouteTimeout = () => {
  const { control, setValue, unregister } = useFormContext<RoutePostType>();
  const timeout = useWatch({ control, name: 'timeout' });
  const [enabled, setEnabled] = useState(() => hasTimeoutValue(timeout));

  useEffect(() => {
    if (hasTimeoutValue(timeout)) {
      setEnabled(true);
    }
  }, [timeout]);

  const enableTimeout = () => {
    setEnabled(true);
  };

  const disableTimeout = () => {
    unregister('timeout');
    setValue('timeout', undefined, { shouldDirty: true });
    setEnabled(false);
  };

  if (!enabled) {
    return (
      <FormSection legend="Timeout" collapsible>
        <Button onClick={enableTimeout}>Configure route timeout</Button>
      </FormSection>
    );
  }

  return (
    <>
      <FormSectionTimeout />
      <Button danger onClick={disableTimeout}>
        Remove route timeout
      </Button>
    </>
  );
};

export const FormPartRoute = ({ showID = true }: { showID?: boolean } = {}) => {
  return (
    <>
      <FormPartBasicWithPriority showID={showID} />
      <FormSectionMatchRules />
      <FormSectionUpstream />
      <FormSectionRouteTimeout />
      <FormSectionPlugins />
      <FormSectionScript />
    </>
  );
};
