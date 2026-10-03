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
import { FormItemPlugins } from './FormItemPlugins';
import { FormPartBasic } from './FormPartBasic';
import { FormSection } from './FormSection';

export const FormPartCredential = () => {
  return (
    <>
      <FormPartBasic showID={false} />
      <FormSection legend="Plugins" collapsible defaultOpen={true}>
        <div
          role="note"
          style={{
            background: 'var(--ant-color-info-bg)',
            border: '1px solid var(--ant-color-info-border)',
            borderRadius: 6,
            color: 'var(--ant-color-text)',
            marginBottom: 12,
            padding: '8px 12px',
          }}
        >
          <strong>Credential plugins store authentication material for this consumer.</strong>
          <div style={{ marginTop: 4 }}>
            Add one credential plugin such as key-auth, jwt-auth, basic-auth, or hmac-auth, then configure its consumer credential fields.
          </div>
        </div>
        <FormItemPlugins name="plugins" schema="consumer_schema" />
      </FormSection>
    </>
  );
};
