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
import { Alert, Descriptions, theme, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { FormItemNumberInput } from '@/components/form/NumberInput';
import { FormItemSelect } from '@/components/form/Select';
import { FormItemSwitch } from '@/components/form/Switch';
import { FormItemTagsInput } from '@/components/form/TagInput';
import { FormItemTextarea } from '@/components/form/Textarea';
import { FormItemTextInput } from '@/components/form/TextInput';
import { APISIX } from '@/types/schema/apisix';

import { FormPartBasic } from '../FormPartBasic';
import { FormSection } from '../FormSection';
import { FormItemCertKeyList } from './FormItemCertKeyList';
import type { SSLPostType } from './schema';

const FormSectionClient = () => {
  const { control, unregister, setValue } = useFormContext<SSLPostType>();
  const client = useWatch({ control, name: 'client' });
  const clientFlag = useWatch({ control, name: '__clientEnabled' });
  const clientEnabled = clientFlag ?? !!client;
  useEffect(() => {
    if (clientFlag === undefined) setValue('__clientEnabled', !!client);
  }, [clientFlag, client, setValue]);
  const { token } = theme.useToken();
  return (
    <FormSection
      legend="Client"
      extra={(
        <FormItemSwitch
          control={control}
          name="__clientEnabled"
          onChange={(enabled) => {
            if (!enabled) {
              unregister('client');
              setValue('client', undefined, { shouldDirty: true });
            }
          }}
          aria-label="Enable client certificate verification"
        />
      )}
      collapsible
      defaultOpen
    >
      {clientEnabled ? (
        <>
          <FormItemTextarea
            control={control}
            label="Client CA Certificate"
            name="client.ca"
          />
          <FormItemNumberInput
            control={control}
            label="Verification Depth"
            name="client.depth"
            defaultValue={1}
            min={0}
          />
          <FormItemTagsInput
            control={control}
            name="client.skip_mtls_uri_regex"
            label="Skip mTLS URI Regex"
            placeholder="/health, /status"
          />
        </>
      ) : (
        <Typography.Text style={{ color: token.colorTextSecondary, fontSize: 'var(--app-font-size-base)' }}>
          Disabled, click switch to enable
        </Typography.Text>
      )}
    </FormSection>
  );
};
const FormSSLValidity = () => {
  const { control } = useFormContext<SSLPostType & { validity_start?: number; validity_end?: number }>();
  const validityStart = useWatch({ control, name: 'validity_start' as never });
  const validityEnd = useWatch({ control, name: 'validity_end' as never });
  if (!validityStart && !validityEnd) return null;
  return (
    <Descriptions
      bordered
      size="small"
      column={1}
      style={{ marginBottom: 16 }}
      items={[
        ...(validityStart
          ? [{ key: 'validity_start', label: 'Valid From', children: dayjs.unix(Number(validityStart)).format('YYYY-MM-DD HH:mm:ss') }]
          : []),
        ...(validityEnd
          ? [{ key: 'validity_end', label: 'Valid Until', children: dayjs.unix(Number(validityEnd)).format('YYYY-MM-DD HH:mm:ss') }]
          : []),
      ]}
    />
  );
};

const FormSectionServerNames = () => {
  const { control } = useFormContext<SSLPostType>();
  const certificateType = useWatch({ control, name: 'type' });
  const isServer = certificateType !== 'client';
  const sni = useWatch({ control, name: 'sni' });
  const snis = useWatch({ control, name: 'snis' });
  const hasSni = typeof sni === 'string' && sni.trim().length > 0;
  const hasSnis = Array.isArray(snis) && snis.length > 0;

  return (
    <FormSection legend="Server Names" collapsible defaultOpen={true}>
      {isServer && hasSni && hasSnis && (
        <Alert
          type="warning"
          showIcon
          title="Both SNI and SNIs are set."
          description="APISIX accepts a single SNI or multiple SNIs. Keep one input style active so the submitted certificate binding is unambiguous."
          style={{ marginBottom: 12 }}
        />
      )}
      <FormItemTextInput
        control={control}
        label="SNI"
        name="sni"
        rules={{ deps: 'snis' }}
        placeholder="domain1.com"
        required={isServer && !hasSnis}
        disabled={isServer && hasSnis && !hasSni}
        description={!isServer ? 'Optional for client certificates.' : hasSnis && !hasSni ? 'Disabled because SNIs is set.' : 'Use this for one hostname.'}
      />
      <FormItemTagsInput
        control={control}
        label="SNIs"
        name="snis"
        rules={{ deps: 'sni' }}
        placeholder="domain1.com, domain2.com"
        disabled={isServer && hasSni && !hasSnis}
        description={!isServer ? 'Optional for client certificates.' : hasSni && !hasSnis ? 'Disabled because SNI is set.' : 'Use this for multiple hostnames.'}
      />
    </FormSection>
  );
};

export const FormPartSSL = ({ showID = true }: { showID?: boolean } = {}) => {
  const { control } = useFormContext<SSLPostType>();
  return (
    <>
      <FormPartBasic
        showID={showID}
        showName={false}
        showStatus
      />
      <FormSSLValidity />
      <FormItemSelect
        control={control}
        name="type"
        label="Certificate Type"
        data={APISIX.SSLType.options.map((v) => v.value.toString())}
        defaultValue={APISIX.SSLType.options[0].value.toString()}
      />
      <FormItemTagsInput
        control={control}
        name="ssl_protocols"
        label="SSL Protocols"
        data={APISIX.SSLProtocols.options.map((v) => v.value.toString())}
      />
      <FormSectionServerNames />
      <FormItemCertKeyList />
      <FormSectionClient />
    </>
  );
};
