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
import { Alert, Button, theme, Typography } from 'antd';
import type { PropsWithChildren, ReactNode } from 'react';
import { useFieldArray, useFormContext, useFormState, useWatch } from 'react-hook-form';

import { FormItemTextareaWithUpload } from '@/components/form/TextareaWithUpload';
import IconDelete from '~icons/material-symbols/delete-forever-outline';

import { FormSection } from '../FormSection';
import type { SSLPostType } from './schema';

const PairWrapper = (
  props: PropsWithChildren & { description?: ReactNode; legend?: ReactNode }
) => {
  const { children, description, legend } = props;
  const { token } = theme.useToken();
  return (
    <fieldset style={{ padding: 8, marginBottom: 5, border: `1px solid ${token.colorBorder}`, borderRadius: 4 }}>
      {legend && <legend>{legend}</legend>}
      {description && (
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 'var(--app-font-size-sm)', marginBottom: 8 }}>
          {description}
        </Typography.Text>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {children}
      </div>
    </fieldset>
  );
};

const SECRET_REF_HINT =
  'Supports $secret:// references (e.g. $secret://vault/my-cert)';

const RequiredCertKey = () => {
  const { control } = useFormContext<SSLPostType>();
  return (
    <PairWrapper description="Required default certificate/key pair. Certificate 1 is submitted with Private Key 1.">
      <FormItemTextareaWithUpload
        control={control}
        label="Certificate 1"
        name="cert"
        required
        description={SECRET_REF_HINT}
      />
      <FormItemTextareaWithUpload
        control={control}
        label="Private Key 1"
        name="key"
        required
        description={SECRET_REF_HINT}
      />
    </PairWrapper>
  );
};
const CertKeyPairList = () => {
  const certsState = useFormState<SSLPostType>({ name: 'certs' });
  const certs = useFieldArray({
    name: 'certs',
  });
  const keys = useFieldArray({
    name: 'keys',
  });
  const certValues = useWatch<SSLPostType, 'certs'>({ name: 'certs' });
  const keyValues = useWatch<SSLPostType, 'keys'>({ name: 'keys' });
  const additionalCount = Math.max(certValues?.length ?? 0, keyValues?.length ?? 0);
  const pairCount = 1 + additionalCount;
  const hasMismatchedPairs = (certValues?.length ?? 0) !== (keyValues?.length ?? 0);
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-md)' }}>
          {pairCount} certificate/key pair{pairCount === 1 ? '' : 's'} configured. Additional certificate and key arrays are matched by position.
        </Typography.Text>
      </div>
      {hasMismatchedPairs && (
        <Alert
          type="warning"
          showIcon
          message="Certificate and key arrays are out of sync."
          description="Each additional certificate must have a private key at the same position. Fill the missing certificate or key below, or remove the incomplete pair."
          style={{ marginBottom: 12 }}
        />
      )}
      {Array.from({ length: additionalCount }, (_, idx) => (
        <PairWrapper
          key={certs.fields[idx]?.id ?? keys.fields[idx]?.id ?? idx}
          description={`Certificate ${idx + 2} is submitted with Private Key ${idx + 2}.`}
          legend={
            !certsState.disabled && (
              <Button
                icon={<IconDelete />}
                size="small"
                danger
                onClick={() => {
                  certs.remove(idx);
                  keys.remove(idx);
                }}
              >
                Remove pair {idx + 2}
              </Button>
            )
          }
        >
          <FormItemTextareaWithUpload
            name={`certs.${idx}`}
            label={`Certificate ${idx + 2}`}
            description={SECRET_REF_HINT}
            required
          />
          <FormItemTextareaWithUpload
            name={`keys.${idx}`}
            label={`Private Key ${idx + 2}`}
            required
            description={SECRET_REF_HINT}
          />
        </PairWrapper>
      ))}
      {!certsState.disabled && (
        <Button
          style={{ marginTop: 16, width: '100%' }}
          size="small"
          onClick={() => {
            keys.append('');
            certs.append('');
          }}
        >
          Add certificate/key pair
        </Button>
      )}
    </>
  );
};
export const FormItemCertKeyList = () => {
  return (
    <FormSection legend="Certificate and Key Pairs">
      <RequiredCertKey />
      <CertKeyPairList />
    </FormSection>
  );
};
