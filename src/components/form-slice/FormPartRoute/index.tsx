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
import { useContext, useEffect, useRef, useState } from 'react';
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

import { FormDraftRevisionContext, useFormReadOnlyFields } from '../../../utils/form-context';
import { FormItemPlugins } from '../FormItemPlugins';
import { FormPartBasic } from '../FormPartBasic';
import { FormPartUpstream, FormSectionTimeout } from '../FormPartUpstream';
import { FormSection } from '../FormSection';
import {
  DependencyChoice,
  ResourceHierarchy,
} from '../ResourceHierarchy';
import { FormItemVars } from './FormItemVars';
import { MatchField } from './MatchField';
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
  return (
    <FormSection legend="Match Rules" collapsible defaultOpen={true}>
      <FormItemTagsInput
        control={control}
        name="methods"
        label="HTTP Methods"
        data={APISIX.HttpMethod.options.map((v) => v.value)}
      />
      <MatchField single="uri" multiple="uris" label="URI" pluralLabel="URIs" placeholder="/api/*" help="Match the request path. Choose Single or Multiple; at least one path is required." required />
      <MatchField single="host" multiple="hosts" label="Host" pluralLabel="Hosts" placeholder="api.example.com" help="Leave empty to match any hostname." />
      <MatchField single="remote_addr" multiple="remote_addrs" label="Remote Address" pluralLabel="Remote Addresses" placeholder="192.0.2.0/24" help="Optional client IP or CIDR. Leave empty to match any client." />
      <InputWrapper label="Enable WebSocket">
        <FormItemSwitch control={control} name="enable_websocket" aria-label="Enable WebSocket" />
      </InputWrapper>
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
  const { control, setValue, getValues, formState } = useFormContext<RoutePostType>();
  const draftRevision = useContext(FormDraftRevisionContext);
  const targetDrafts = useRef<Partial<RoutePostType>>({});
  useEffect(() => { targetDrafts.current = {}; }, [draftRevision, formState.defaultValues]);
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
    if (next === targetMode) return;
    const current = getValues();
    // Store only in memory; inactive alternatives never enter the API payload.
    for (const key of ['service_id', 'upstream_id', 'upstream'] as const) {
      if (current[key] !== undefined) Object.assign(targetDrafts.current, { [key]: structuredClone(current[key]) });
    }
    const selectedKey = next === 'service' ? 'service_id' : next === 'upstream' ? 'upstream_id' : 'upstream';
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
    setValue(selectedKey, structuredClone(targetDrafts.current[selectedKey]), { shouldDirty: true, shouldValidate: true });
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
      >
        <Segmented
          block
          value={targetMode}
          options={targetOptions}
          onChange={(value) => selectTargetMode(value as TargetMode)}
        />
      </InputWrapper>
      <p style={{ color: 'var(--ant-color-text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Switch targets without losing your work. Alternatives are kept until you save, revert, or apply JSON; only the selected target is submitted.
      </p>
      {serviceId && (
        <Alert
          type="info"
          showIcon
          title="Traffic resolves through the selected Service."
          description="Existing Route-level Upstream overrides are preserved on save. Use Admin API JSON to inspect or edit combined configurations."
          style={{ marginBottom: 12 }}
        />
      )}
      {!serviceId && upstreamId && (
        <Alert
          type="info"
          showIcon
          title="Upstream ID is set. Any existing inline configuration is preserved until you change the target."
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
