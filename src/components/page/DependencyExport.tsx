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

import { Alert, Button, Checkbox, Modal, Space, Table, Tag, Typography } from 'antd';
import { useRef, useState } from 'react';

import { type DependencyExportOptions, dependencyExportScope, prepareDependencyExport, supportsDependencyExport } from '@/apis/dependency-export';
import { downloadJson } from '@/utils/downloadJson';

export const DependencyExport = ({ apiBase, selectedIds, disabled }: {
  apiBase: string; selectedIds: string[]; disabled: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [data, setData] = useState<Awaited<ReturnType<typeof prepareDependencyExport>>>();
  const [error, setError] = useState('');
  const [options, setOptions] = useState<DependencyExportOptions>({});
  const sequence = useRef(0);
  if (!supportsDependencyExport(apiBase)) return null;
  const refresh = async (selection: string[], scope = options) => {
    const request = ++sequence.current;
    setLoading(true); setData(undefined); setError('');
    try {
      const result = await prepareDependencyExport(apiBase, selection, scope);
      if (request === sequence.current) setData(result);
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : 'Unable to read dependencies.');
    } finally { if (request === sequence.current) setLoading(false); }
  };
  const close = () => { ++sequence.current; setOpen(false); setLoading(false); };
  return <>
    <Button disabled={disabled} onClick={() => {
      setOpen(true); setIds([...selectedIds]); void refresh([...selectedIds]);
    }}>Export with dependencies</Button>
    <Modal title="Export with dependencies" open={open} width={1000} onCancel={close} destroyOnHidden
      footer={<Space wrap><Button onClick={close}>Close export</Button>
        <Button type="primary" disabled={loading || !data || data.blocked > 0} onClick={() => {
          if (!data || data.blocked) return;
          downloadJson(data.data, `apisix-with-dependencies-${new Date().toISOString().slice(0, 10)}.json`);
        }}>Download bundle</Button></Space>}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text strong>{ids.length} selected resources · {apiBase}</Typography.Text>
        <Alert type="info" showIcon message="Included reference scope" description={dependencyExportScope(options)} />
        <Checkbox checked={!!options.graphqlCostDecorations} disabled={loading} onChange={(event) => {
          const next = { ...options, graphqlCostDecorations: event.target.checked }; setOptions(next); void refresh(ids, next);
        }}>Include Service GraphQL cost decorations</Checkbox>
        <Checkbox checked={!!options.pluginReferences} disabled={loading} onChange={(event) => {
          const next = { ...options, pluginReferences: event.target.checked }; setOptions(next); void refresh(ids, next);
        }}>Include supported plugin references (grpc-transcode and traffic-split)</Checkbox>
        <Typography.Paragraph style={{ margin: 0 }}>
          Shared references are included once, including references overridden by a Route.
          The file uses the existing import format. This is a snapshot of sequential reads, not an atomic backup.
          Refresh the preview to include changes made since it was prepared.
        </Typography.Paragraph>
        <Button aria-label="Refresh export preview" loading={loading} disabled={loading} onClick={() => void refresh(ids)}>Refresh export preview</Button>
        {error && <Alert type="error" message="Export could not be prepared" description={error} showIcon />}
        {data && <>
          <div role="status">{data.rows.length - data.blocked} included · {data.blocked} unresolved references</div>
          <Typography.Text type="secondary">Snapshot prepared at {new Date(data.data.exportedAt).toLocaleTimeString()}</Typography.Text>
          {data.blocked > 0 && <Alert type="error" showIcon message="Download blocked"
            description="Resolve the missing or unreadable resources below, then refresh the preview. No partial bundle will be downloaded." />}
          <Table size="small" rowKey="key" dataSource={data.rows} pagination={{ pageSize: 8 }} scroll={{ x: 700 }}
            columns={[
              { title: 'Resource', key: 'resource', render: (_, row) => <Typography.Text code>{row.key}</Typography.Text> },
              { title: 'Included because', key: 'reasons', render: (_, row) => <span style={{ overflowWrap: 'anywhere' }}>{row.reasons.join('; ')}</span> },
              { title: 'Result', key: 'result', render: (_, row) => <Space direction="vertical">
                <Tag color={row.status === 'Included' ? 'green' : 'red'}>{row.status}</Tag>
                {row.error && <Typography.Text type="danger">{row.error}</Typography.Text>}
              </Space> },
            ]} />
        </>}
      </Space>
    </Modal>
  </>;
};

