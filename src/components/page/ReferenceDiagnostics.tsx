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

import { Alert, Button, Collapse, Modal, Space, Table, Tag, Typography } from 'antd';
import { useRef, useState } from 'react';

import { diagnoseReferences } from '@/apis/reference-diagnostics';
import { AffectedRoutes } from '@/components/page/AffectedRoutes';
import { RawDrawer } from '@/components/page/RawDrawer';

export const ReferenceDiagnostics = () => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof diagnoseReferences>>>();
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const refresh = async () => {
    const current = ++sequence.current;
    setLoading(true); setError(''); setResult(undefined);
    try { const next = await diagnoseReferences(); if (sequence.current === current) setResult(next); }
    catch (cause) { if (sequence.current === current) setError(cause instanceof Error ? cause.message : 'Check failed.'); }
    finally { if (sequence.current === current) setLoading(false); }
  };
  const close = () => { ++sequence.current; setOpen(false); setLoading(false); };
  return <>
    <Button onClick={() => { setOpen(true); void refresh(); }}>Check references</Button>
    <Modal title="Configuration reference diagnostics" open={open} width={1100} onCancel={close} destroyOnHidden
      style={{ top: 24 }} styles={{ body: { maxHeight: 'calc(100dvh - 160px)', overflowY: 'auto' } }}
      footer={<Button onClick={close}>Close diagnostics</Button>}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text>Checks standard resource references, grpc-transcode Proto IDs and traffic-split Upstream IDs.</Typography.Text>
        <Collapse size="small" items={[{ key: 'scope', label: 'Checked scope and limitations', children: <Typography.Paragraph style={{ marginBottom: 0 }}>
          Checks saved Route and Stream Route service/upstream references, Route plugin configs, Service upstreams,
          and Consumer groups. Also checks grpc-transcode.proto_id and traffic-split weighted upstream IDs in
          Routes, Stream Routes, Services, Plugin Configs, Consumers, Consumer Groups and Global Rules.
          Other plugin references, plugin schema validity, scripts and runtime routing are not checked.
          Potentially affected Routes include references overridden locally or disabled plugins.
          Consumer plugin impact depends on the authenticated request; Global Rules can affect every HTTP Route. Reads are not an atomic snapshot.
        </Typography.Paragraph> }]} />
        <Button loading={loading} onClick={() => void refresh()}>Refresh reference check</Button>
        {error && <Alert type="error" title={error} showIcon />}
        {result && <>
          <div role="status">{result.issues.filter((row) => row.status !== 'Not verified').length} reference issue(s) / {result.unavailable.length} unavailable collection(s)</div>
          <Typography.Text type="secondary">Checked at {result.checkedAt}</Typography.Text>
          {result.unavailable.length > 0 && <Alert type="warning" showIcon title="Reference check is incomplete"
            description={`Could not verify: ${result.unavailable.join(', ')}. References and affected Route counts may be incomplete. Retry before drawing conclusions.`} />}
          {result.issues.length === 0 && result.unavailable.length === 0 && <Alert type="success" showIcon title="No broken references found in the checked scope" />}
          <Table size="small" rowKey="key" dataSource={result.issues} pagination={{ pageSize: 8 }} scroll={{ x: 950 }}
            locale={{ emptyText: <Typography.Text>{result.unavailable.length > 0 ? 'No findings to display from available collections. Retry the reference check to include unavailable collections.' : 'No reference issues in the checked scope.'}</Typography.Text> }} columns={[
            { title: 'Source / field', key: 'source', render: (_, row) => <Space orientation="vertical"><Typography.Text code>{row.source}</Typography.Text><Typography.Text style={{ overflowWrap: 'anywhere' }}>{row.field}</Typography.Text></Space> },
            { title: 'Target', dataIndex: 'target', render: (value) => <Typography.Text style={{ overflowWrap: 'anywhere' }}>{value}</Typography.Text> },
            { title: 'Result', key: 'status', render: (_, row) => <Tag color={row.status === 'Not verified' ? 'orange' : 'red'}>{row.status}</Tag> },
            { title: 'Potentially affected Routes', key: 'affected', render: (_, row) => <AffectedRoutes routes={row.affected} source={row.source} /> },
            { title: 'Repair', key: 'repair', render: (_, row) => <Button onClick={() => { setEditing(row.source); setOpen(false); }}>Open source RAW</Button> },
          ]} />
        </>}
      </Space>
    </Modal>
    {editing && <RawDrawer open api={editing} title={`Repair reference: ${editing}`} onSaved={refresh}
      onClose={() => { setEditing(undefined); setOpen(true); void refresh(); }} />}
  </>;
};
