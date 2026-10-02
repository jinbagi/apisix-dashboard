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
import { Alert, Button } from 'antd';
import { useEffect, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { FormItemJsonInput } from '@/components/form/JsonInput';
import { FormItemNumberInput } from '@/components/form/NumberInput';
import { FormItemSwitch } from '@/components/form/Switch';
import { FormItemTagsInput } from '@/components/form/TagInput';
import { FormItemTextInput } from '@/components/form/TextInput';

import { FormPartBasic } from '../FormPartBasic';
import {
  FormSectionPlugins,
  FormSectionUpstream,
} from '../FormPartRoute';
import { FormSection } from '../FormSection';
import type { StreamRoutePostType } from './schema';

const FormSectionStreamRouteBasic = () => {
  const { control, setValue, unregister } = useFormContext<StreamRoutePostType>();
  const serverAddr = useWatch({ control, name: 'server_addr' });
  const serverPort = useWatch({ control, name: 'server_port' });
  const remoteAddr = useWatch({ control, name: 'remote_addr' });
  const sni = useWatch({ control, name: 'sni' });
  const snis = useWatch({ control, name: 'snis' });
  const tlsPassthrough = useWatch({ control, name: 'tls_passthrough' });
  const hasSni = typeof sni === 'string' && sni.trim().length > 0;
  const hasSnis = Array.isArray(snis) && snis.length > 0;
  const activeMatchers = [
    serverAddr && 'server address',
    serverPort && 'server port',
    remoteAddr && 'remote address',
    (hasSni || hasSnis) && 'SNI',
  ].filter(Boolean);

  return (
    <FormSection legend="Server" collapsible defaultOpen={true}>
      <Alert
        type={activeMatchers.length > 0 ? 'info' : 'warning'}
        showIcon
        message={
          activeMatchers.length > 0
            ? `Matching by ${activeMatchers.join(', ')}.`
            : 'No stream matching condition is set yet.'
        }
        description="Stream Routes match L4/TLS traffic before it reaches an HTTP route. Configure at least one listener or client condition, then choose a Service, Upstream ID, or inline upstream target."
        style={{ marginBottom: 12 }}
      />
      <FormItemTextInput
        control={control}
        name="server_addr"
        label="Server Address"
        description="Local address APISIX listens on for this stream route."
      />
      <FormItemNumberInput
        control={control}
        name="server_port"
        label="Server Port"
        allowDecimal={false}
        description="Local listener port. Valid range: 1-65535."
      />
      <FormItemTextInput
        control={control}
        name="remote_addr"
        label="Remote Address"
        description="Optional client IP or CIDR condition."
      />
      {hasSni && hasSnis && (
        <Alert
          type="warning"
          showIcon
          message="Both SNI and SNIs are set. Clear one before saving."
          style={{ marginBottom: 12 }}
        />
      )}
      <FormItemTextInput
        control={control}
        name="sni"
        label="SNI"
        disabled={hasSnis && !hasSni}
        description={hasSnis && !hasSni ? 'Clear SNIs to use one hostname.' : 'Optional TLS Server Name condition. Use SNI or SNIs.'}
      />
      <FormItemTagsInput
        control={control}
        name="snis"
        label="SNIs"
        placeholder="api.example.com, *.example.com"
        splitChars={[',']}
        allowClear
        disabled={hasSni && !hasSnis}
        description={hasSni && !hasSnis ? 'Clear SNI to use multiple hostnames.' : 'Match any listed name. Wildcards such as *.example.com and * are supported.'}
      />
      <FormItemSwitch
        control={control}
        name="tls_passthrough"
        label="TLS Passthrough"
        description="On a mixed TCP listener configured with both tls: true and tls_passthrough: true, forward encrypted TLS to the upstream. Disabled or omitted terminates TLS at APISIX. Dedicated listeners use their listener configuration regardless of this route setting."
      />
      <Button
        type="link"
        disabled={tlsPassthrough === undefined}
        onClick={() => {
          unregister('tls_passthrough');
          setValue('tls_passthrough', undefined, { shouldDirty: true, shouldValidate: true });
        }}
      >
        Clear TLS passthrough setting
      </Button>
      {tlsPassthrough && (
        <Alert
          type="info"
          showIcon
          message="The upstream terminates the client TLS handshake."
          description="Use a TCP upstream; scheme tls would start a second TLS handshake and is rejected by APISIX. For a referenced Service or Upstream, check its scheme too. Gateway mTLS and payload-inspecting plugins such as mqtt-proxy, xrpc and redis do not apply to the encrypted stream."
          style={{ marginTop: 12 }}
        />
      )}
    </FormSection>
  );
};

const hasProtocolValue = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    return Object.values(value).some(hasProtocolValue);
  }
  return true;
};

const FormSectionStreamRouteProtocol = () => {
  const { control, setValue, unregister } = useFormContext<StreamRoutePostType>();
  const protocol = useWatch({ control, name: 'protocol' });
  const [enabled, setEnabled] = useState(() => hasProtocolValue(protocol));

  useEffect(() => {
    if (hasProtocolValue(protocol)) {
      setEnabled(true);
    }
  }, [protocol]);

  const enableProtocol = () => {
    setEnabled(true);
  };

  const removeProtocol = () => {
    unregister('protocol');
    setValue('protocol', undefined, { shouldDirty: true });
    setEnabled(false);
  };

  if (!enabled) {
    return (
      <FormSection legend="Protocol Information" collapsible>
        <Button onClick={enableProtocol}>Configure protocol information</Button>
      </FormSection>
    );
  }

  return (
    <>
      <FormSection legend="Protocol Information" collapsible defaultOpen>
        <FormItemTextInput
          control={control}
          name="protocol.name"
          label="Protocol Name"
          description="Optional stream protocol extension name."
        />
        <FormItemTextInput
          control={control}
          name="protocol.superior_id"
          label="Superior ID"
          description="Optional parent protocol resource ID."
        />
        <FormItemJsonInput
          control={control}
          name="protocol.conf"
          label="Conf"
          toObject
          description="Optional protocol configuration JSON object."
        />
        <FormItemJsonInput
          control={control}
          name="protocol.logger"
          label="Logger"
          toObject
          objValue={[]}
          description="Optional logger array for protocol-specific logging."
        />
      </FormSection>
      <Button danger onClick={removeProtocol}>
        Remove protocol information
      </Button>
    </>
  );
};

export const FormPartStreamRoute = ({ showID = true }: { showID?: boolean } = {}) => {
  return (
    <>
      <FormPartBasic showID={showID} showName={false} />
      <FormSectionStreamRouteBasic />
      <FormSectionUpstream />
      <FormSectionPlugins showPluginConfig={false} subsystem="stream" />
      <FormSectionStreamRouteProtocol />
    </>
  );
};
