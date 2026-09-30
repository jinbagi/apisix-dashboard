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
import { Alert, Divider } from 'antd';
import { useContext, useEffect, useRef } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { InputWrapper } from '@/components/form/InputWrapper';
import { FormItemPasswordInput } from '@/components/form/PasswordInput';
import { FormItemSelect } from '@/components/form/Select';
import { FormItemSwitch } from '@/components/form/Switch';
import { FormItemTextInput } from '@/components/form/TextInput';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { FormDraftRevisionContext } from '@/utils/form-context';

import { FormItemTagsInput } from '../form/TagInput';
import { FormSection } from './FormSection';

const VaultSecretForm = () => {
  const { control } = useFormContext<APISIXType['Secret']>();

  return (
    <>
      <Alert
        type="info"
        showIcon
        message="Vault secrets are referenced as $secret://vault/{id}/{key} in APISIX resources."
        description="URI, Prefix, and Token are required to connect APISIX to Vault. Namespace is optional for Vault Enterprise setups."
        style={{ marginBottom: 12 }}
      />
      <FormItemTextInput
        control={control}
        name="uri"
        label="URI"
        required
        description="Vault server URI, for example http://127.0.0.1:8200."
      />
      <FormItemTextInput
        control={control}
        name="prefix"
        label="Prefix"
        required
        description="Path prefix where APISIX reads secret entries."
      />
      <FormItemPasswordInput
        control={control}
        name="token"
        label="Token"
        required
        description="Vault token used by APISIX to read secrets."
      />
      <FormItemTextInput
        control={control}
        name="namespace"
        label="Namespace"
        description="Optional Vault namespace."
      />
    </>
  );
};

const AWSSecretForm = () => {
  const { control } = useFormContext<APISIXType['Secret']>();

  return (
    <>
      <Alert
        type="info"
        showIcon
        message="AWS Secrets Manager references use this credential set."
        description="Access Key ID and Secret Access Key are required. Session Token is only needed for temporary credentials."
        style={{ marginBottom: 12 }}
      />
      <FormItemPasswordInput
        control={control}
        name="access_key_id"
        label="Access Key ID"
        required
      />
      <FormItemPasswordInput
        control={control}
        name="secret_access_key"
        label="Secret Access Key"
        required
      />
      <FormItemPasswordInput
        control={control}
        name="session_token"
        label="Session Token"
        description="Optional STS session token."
      />

      <FormItemTextInput
        control={control}
        name="region"
        label="Region"
        description="Optional AWS region. Leave empty to use the APISIX runtime default."
      />
      <FormItemTextInput
        control={control}
        name="endpoint_url"
        label="Endpoint URL"
        description="Optional custom endpoint for local or compatible secret stores."
      />
    </>
  );
};

const GCPSecretForm = () => {
  const { control } = useFormContext<APISIXType['Secret']>();
  const authFile = useWatch({ control, name: 'auth_file' });
  const authConfig = useWatch({ control, name: 'auth_config' });
  const hasAuthFile = typeof authFile === 'string' && authFile.trim().length > 0;
  const hasAuthConfig =
    !!authConfig &&
    typeof authConfig === 'object' &&
    Object.values(authConfig).some((value) => {
      if (Array.isArray(value)) return value.length > 0;
      return typeof value === 'string' ? value.trim().length > 0 : !!value;
    });

  return (
    <>
      <Alert
        type="info"
        showIcon
        message="GCP Secret Manager can authenticate with either an auth file path or inline auth configuration."
        description="Use one authentication method for a predictable submitted payload."
        style={{ marginBottom: 12 }}
      />
      {hasAuthFile && hasAuthConfig && (
        <Alert
          type="warning"
          showIcon
          message="Both GCP authentication methods are filled."
          description="Keep either Auth File or Auth Configuration active so APISIX uses the intended credential source."
          style={{ marginBottom: 12 }}
        />
      )}
      <InputWrapper label="SSL Verify">
        <FormItemSwitch
          control={control}
          name="ssl_verify"
          aria-label="SSL Verify"
        />
      </InputWrapper>
      <FormSection legend="Auth" collapsible defaultOpen={true}>
        <FormItemTextInput
          control={control}
          name="auth_file"
          label="Auth File"
          description="Path to a service account JSON file available to the APISIX runtime."
        />
        <Divider style={{ margin: '8px 0' }}>OR</Divider>
        <FormSection legend="Auth Configuration" collapsible defaultOpen>
          <FormItemTextInput
            control={control}
            name="auth_config.client_email"
            label="Client Email"
            required={!hasAuthFile}
          />
          <FormItemPasswordInput
            control={control}
            name="auth_config.private_key"
            label="Private Key"
            required={!hasAuthFile}
          />
          <FormItemTextInput
            control={control}
            name="auth_config.project_id"
            label="Project ID"
            required={!hasAuthFile}
          />
          <FormItemTextInput
            control={control}
            name="auth_config.token_uri"
            label="Token URI"
          />
          <FormItemTagsInput
            control={control}
            name="auth_config.scope"
            label="Scope"
            description="Optional OAuth scopes."
          />
          <FormItemTextInput
            control={control}
            name="auth_config.entries_uri"
            label="Entries URI"
          />
        </FormSection>
      </FormSection>
    </>
  );
};

const managerFields = {
  vault: ['uri', 'prefix', 'token', 'namespace'],
  aws: ['access_key_id', 'secret_access_key', 'session_token', 'region', 'endpoint_url'],
  gcp: ['auth_file', 'auth_config', 'ssl_verify'],
} as const;
type Manager = keyof typeof managerFields;

type FormSectionManagerProps = { readOnlyManager?: boolean };
const FormSectionManager = (props: FormSectionManagerProps) => {
  const { readOnlyManager } = props;
  const { control, watch, getValues, unregister, setValue, formState } = useFormContext<APISIXType['Secret']>();
  const manager = watch('manager');
  const revision = useContext(FormDraftRevisionContext);
  const drafts = useRef<Partial<Record<Manager, Record<string, unknown>>>>({});
  useEffect(() => { drafts.current = {}; }, [revision, formState.defaultValues]);
  const changeManager = (next: Manager) => {
    if (next === manager) return;
    const values = getValues() as Record<string, unknown>;
    if (manager && manager in managerFields) {
      drafts.current[manager] = Object.fromEntries(managerFields[manager].map((key) => [key, values[key]]));
    }
    for (const fields of Object.values(managerFields)) {
      for (const key of fields) unregister(key);
    }
    setValue('manager', next, { shouldDirty: true });
    for (const key of managerFields[next]) {
      setValue(key, drafts.current[next]?.[key] as never, { shouldDirty: true });
    }
  };
  return (
    <FormSection legend="Secret Manager" disabled={readOnlyManager} collapsible defaultOpen={true}>
      <FormItemSelect
        control={control}
        name="manager"
        label="Manager"
        onChange={(next) => changeManager(next as Manager)}
        defaultValue={APISIX.Secret.options[0].shape.manager.value}
        data={APISIX.Secret.options.map((v) => v.shape.manager.value)}
      />
    </FormSection>
  );
};

const FormSectionManagerConfig = () => {
  const { watch } = useFormContext<APISIXType['Secret']>();
  // useWatch not working here
  const manager = watch('manager');
  return (
    <FormSection legend="Manager Configuration" collapsible defaultOpen={true}>
      {manager === 'vault' && <VaultSecretForm />}
      {manager === 'aws' && <AWSSecretForm />}
      {manager === 'gcp' && <GCPSecretForm />}
    </FormSection>
  );
};

/**
 * id and manager cannot be changed when editing
 */
export const FormPartSecret = (props: FormSectionManagerProps) => {
  const { readOnlyManager } = props;
  return (
    <>
      <FormSectionManager readOnlyManager={readOnlyManager} />
      <FormSectionManagerConfig />
    </>
  );
};
