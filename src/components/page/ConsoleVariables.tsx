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
import { Alert, Button, Collapse, Input, Modal, Space, Typography } from 'antd';
import { useState } from 'react';

import { JsonCodeEditor } from '@/components/form/JsonCodeEditor';
import { type ConsoleTemplate, type ConsoleVariable, resolveConsoleTemplate } from '@/utils/consoleTemplates';

type Props = { template: ConsoleTemplate; disabled: boolean; onOpenChange: (open: boolean) => void; onResolved: (value: ConsoleTemplate) => void };
export const ConsoleVariables = ({ template, disabled, onOpenChange, onResolved }: Props) => {
  const [open, setOpenState] = useState(false);
  const setOpen = (value: boolean) => { setOpenState(value); onOpenChange(value); };
  const [variables, setVariables] = useState<ConsoleVariable[]>([]);
  const [resolved, setResolved] = useState<ConsoleTemplate>(); const [error, setError] = useState('');
  const update = (index: number, patch: Partial<ConsoleVariable>) => {
    setVariables((current) => current.map((item, row) => row === index ? { ...item, ...patch } : item)); setResolved(undefined); setError('');
  };
  return <>
    <Button size="small" disabled={disabled} onClick={() => { setResolved(undefined); setError(''); setOpen(true); }}>Variables</Button>
    <Modal title="Resolve request variables" open={open} onCancel={() => setOpen(false)} width={850} style={{ top: 24 }} destroyOnHidden
      styles={{ container: { maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column' }, header: { flexShrink: 0 }, body: { minHeight: 0, overflowY: 'auto' }, footer: { flexShrink: 0 } }}
      footer={<Space wrap><Button onClick={() => setOpen(false)}>Keep template</Button><Button type="primary" disabled={!resolved || disabled} onClick={() => { if (resolved) { onResolved(resolved); setOpen(false); } }}>Use resolved request</Button></Space>}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Paragraph style={{ margin: 0 }}>Review the resolved draft before sending. Values stay in memory on this page.</Typography.Paragraph>
        <Collapse size="small" items={[{ key: 'syntax', label: 'Variable syntax and handling', children: <Typography.Paragraph style={{ margin: 0 }}>Use {'{{name}}'} in the path, query or JSON string values. Use non-secret values. Path and query replacements are URL encoded. JSON replacements remain strings. This step prepares a draft and sends no request.</Typography.Paragraph> }]} />
        {variables.map((item, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr) auto', gap: 8 }}>
          <Input aria-label={`Variable ${index + 1} name`} placeholder="route_id" value={item.name} maxLength={64} onChange={(event) => update(index, { name: event.target.value })} />
          <Input aria-label={`Variable ${index + 1} value`} placeholder="example-route" value={item.value} maxLength={4096} onChange={(event) => update(index, { value: event.target.value })} />
          <Button aria-label={`Remove variable ${index + 1}`} onClick={() => { setVariables((current) => current.filter((_, row) => row !== index)); setResolved(undefined); setError(''); }}>Remove</Button>
        </div>)}
        <Space wrap><Button disabled={variables.length >= 30} onClick={() => { setVariables((current) => [...current, { name: '', value: '' }]); setResolved(undefined); }}>Add variable</Button>
          {!!variables.length && <Button onClick={() => { setVariables([]); setResolved(undefined); setError(''); }}>Clear variables</Button>}
          <Button onClick={() => { setResolved(undefined); try { setResolved(resolveConsoleTemplate(template, variables)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not resolve variables'); } }}>Preview resolved request</Button></Space>
        {error && <Alert type="error" title="Resolution blocked" description={error} />}
        {resolved && <>
          <Typography.Text strong>Resolved request · {resolved.method}</Typography.Text>
          <Typography.Text code style={{ overflowWrap: 'anywhere' }}>{resolved.endpoint}</Typography.Text>
          {!['GET', 'DELETE'].includes(resolved.method) && <JsonCodeEditor height="260px" value={resolved.body} readOnly options={{ ariaLabel: 'Resolved request JSON' }} />}
          <Alert type="info" title="Review the request before using it" description="Use resolved request updates the Console draft. Sending remains a separate explicit action." />
        </>}
      </Space>
    </Modal>
  </>;
};
