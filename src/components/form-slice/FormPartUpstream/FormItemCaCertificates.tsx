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
import { Alert, Button, Input, Upload } from 'antd';
import { useState } from 'react';
import { useController, useFormContext, useFormState } from 'react-hook-form';

import { InputWrapper } from '@/components/form/InputWrapper';
import { useNamePrefix } from '@/utils/useNamePrefix';

import type { FormPartUpstreamType } from './schema';

export const FormItemCaCertificates = ({ disableAdd }: { disableAdd: boolean }) => {
  const { control, getFieldState, getValues } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  const name = np('tls.ca_certs');
  const formState = useFormState({ control, name });
  const { field, fieldState } = useController({ control, name });
  const certificates = Array.isArray(field.value) ? field.value : [];
  const [fileError, setFileError] = useState<string>();

  // Register the flat string array as one field so deleting a certificate cannot
  // leave an old indexed controller behind and reintroduce it into the payload.
  const updateCertificate = (index: number, value: string) => {
    const current = getValues(name);
    const next = Array.isArray(current) ? [...current] : [];
    next[index] = value;
    field.onChange(next);
    setFileError(undefined);
  };

  return (
    <InputWrapper
      label="Trusted CA Certificates"
      fieldPath={name}
      error={fieldState.error?.message}
      description="PEM CA certificates for upstream verification. When omitted, APISIX uses its gateway trust configuration. Each certificate must be 128–65536 characters."
    >
      {fileError && <Alert type="error" message={fileError} />}
      {certificates.map((certificate, index) => (
        <div key={index} style={{ marginBottom: 12 }}>
          <InputWrapper
            label={`CA Certificate ${index + 1}`}
            fieldPath={np(`tls.ca_certs.${index}`)}
            error={getFieldState(np(`tls.ca_certs.${index}`), formState).error?.message}
          >
            <Input.TextArea
              aria-label={`CA Certificate ${index + 1}`}
              value={certificate}
              disabled={field.disabled}
              autoSize={{ minRows: 3 }}
              onBlur={field.onBlur}
              onChange={(event) => updateCertificate(index, event.target.value)}
            />
          </InputWrapper>
          <Upload
            accept=".pem,.crt,.cer"
            showUploadList={false}
            disabled={field.disabled}
            beforeUpload={async (file) => {
              if (file.size > 65536) {
                setFileError('CA certificate files must be at most 64 KiB.');
                return false;
              }
              try {
                updateCertificate(index, await file.text());
              } catch {
                setFileError('Could not read the CA certificate file.');
              }
              return false;
            }}
          >
            <Button size="small" disabled={field.disabled}>
              Upload CA Certificate {index + 1}
            </Button>
          </Upload>
          <Button
            danger
            size="small"
            style={{ marginLeft: 8 }}
            disabled={field.disabled}
            onClick={() => {
              const next = certificates.filter((_, position) => position !== index);
              field.onChange(next.length ? next : undefined);
              setFileError(undefined);
            }}
          >
            Remove CA Certificate {index + 1}
          </Button>
        </div>
      ))}
      <Button
        disabled={field.disabled || disableAdd}
        onClick={() => field.onChange([...certificates, ''])}
      >
        Add CA Certificate
      </Button>
    </InputWrapper>
  );
};
