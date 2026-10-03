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

import { useBlocker } from '@tanstack/react-router';
import { Alert, Button, Modal, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';

import { applyBulkPatchRow, type BulkPatchRow, isBulkPatchFailure, parseBulkPatch, prepareBulkPatch, supportsBulkPatch } from '@/apis/bulk-patch';
import { JsonChangeReview } from '@/components/form/JsonChangeReview';
import { JsonCodeEditor } from '@/components/form/JsonCodeEditor';
import { queryClient } from '@/config/global';

type Props = {
  apiBase: string;
  selectedIds: string[];
  disabled: boolean;
  onComplete: (failedIds?: string[]) => void;
};
export const BulkRawEdit = ({ apiBase, selectedIds, disabled, onComplete }: Props) => {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [json, setJson] = useState('{}');
  const [rows, setRows] = useState<BulkPatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<BulkPatchRow>();
  const ready = rows.filter((row) => row.status === 'Ready');
  const failed = rows.filter(isBulkPatchFailure);
  const pending = !applied && json.trim() !== '{}';
  const navigationBlocker = useBlocker({
    shouldBlockFn: () => open && (pending || busy || ready.length > 0),
    enableBeforeUnload: () => open && (pending || busy || ready.length > 0),
    withResolver: true,
  });
  if (!supportsBulkPatch(apiBase)) return null;
  const close = () => {
    if (busy) return;
    const finish = () => {
      setOpen(false);
      if (applied) {
        onComplete(rows.filter((row) => !['Saved', 'Unchanged'].includes(row.status)).map((row) => row.id));
        void queryClient.invalidateQueries();
      }
    };
    if (pending || ready.length) Modal.confirm({
      title: 'Close without applying these changes?', content: 'The bulk JSON and pending preview will be discarded.',
      okText: 'Discard changes', cancelText: 'Keep editing', onOk: finish,
    });
    else finish();
  };
  const preview = async (retry = false) => {
    setError(''); setBusy(true);
    try {
      const patch = parseBulkPatch(json);
      const updated = await prepareBulkPatch(apiBase, retry ? failed.map((row) => row.id) : ids, patch);
      setRows(retry ? rows.map((row) => updated.find((item) => item.id === row.id) ?? row) : updated);
    } catch (cause) {
      setRows([]); setError(cause instanceof Error ? cause.message : 'Preview failed');
    } finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); setApplied(true);
    let next = rows;
    try {
      for (const row of ready) {
        const result = await applyBulkPatchRow(row);
        next = next.map((item) => item.id === row.id ? result : item);
        setRows(next);
      }
    } finally { setBusy(false); }
  };
  return <>
    <Button disabled={disabled} onClick={() => {
      setIds([...selectedIds]); setJson('{}'); setRows([]); setApplied(false); setError(''); setOpen(true);
    }}>Edit RAW</Button>
    <Modal title="Bulk RAW edit" open={open} width={1000} onCancel={close} maskClosable={false}
      closable={!busy} keyboard={!busy} destroyOnHidden
      footer={<Space wrap>
        <Button disabled={busy} onClick={close}>Close bulk editor</Button>
        {failed.length > 0 && <Button disabled={busy} onClick={() => void preview(true)}>Preview failed items again</Button>}
        <Button type="primary" aria-label={`Apply ${ready.length} changes`} loading={busy} disabled={busy || !ready.length} onClick={() => void apply()}>
          Apply {ready.length} changes
        </Button>
      </Space>}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text strong>{ids.length} selected resources · {apiBase}</Typography.Text>
        <Typography.Paragraph style={{ margin: 0 }}>
          Change only the fields in this JSON. Objects merge, arrays are replaced, and null removes a field.
          Each item is checked again before PATCH and verified after saving. Changes are not atomic;
          a failed item does not roll back successful items. Concurrent edits after the final check can still occur.
        </Typography.Paragraph>
        <JsonCodeEditor height="200px" value={json} readOnly={busy || applied}
          options={{ ariaLabel: 'Bulk JSON patch' }}
          onChange={(value) => { setJson(value ?? ''); setRows([]); setError(''); }} />
        <Typography.Text type="secondary">Example: {'{"labels":{"env":"staging"}}'}. IDs and timestamps cannot be changed.</Typography.Text>
        <Button aria-label="Preview changes" loading={busy} disabled={busy || applied} onClick={() => void preview()}>Preview changes</Button>
        {error && <Alert type="error" showIcon message="Preview blocked" description={error} />}
        {rows.length > 0 && <>
          <div role="status">{ready.length} ready · {rows.filter((row) => row.status === 'Saved').length} saved and verified · {rows.filter((row) => row.status === 'Unchanged').length} unchanged · {failed.length} need attention</div>
          <Table size="small" rowKey="id" dataSource={rows} pagination={{ pageSize: 6 }} scroll={{ x: 650 }}
            columns={[
              { title: 'ID', dataIndex: 'id', width: 160 },
              { title: 'Result', key: 'result', render: (_, row) => <Space direction="vertical">
                <Tag color={isBulkPatchFailure(row) ? 'red' : row.status === 'Saved' ? 'green' : 'blue'}>{row.status}</Tag>
                {row.error && <Typography.Text type="danger" style={{ overflowWrap: 'anywhere' }}>{row.error}</Typography.Text>}
              </Space> },
              { title: 'Changes', key: 'changes', width: 145, render: (_, row) =>
                <Button size="small" disabled={!row.before || !row.after || busy} onClick={() => setReview(row)}>Compare JSON</Button> },
            ]} />
        </>}
      </Space>
    </Modal>
    <JsonChangeReview open={!!review} original={JSON.stringify(review?.before, null, 2) ?? ''}
      modified={JSON.stringify(review?.after, null, 2) ?? ''} title={`Changes for ${review?.id ?? ''}`}
      description="Saved value at preview time compared with the proposed result. This comparison does not apply changes."
      confirmText="Back to bulk editor" onCancel={() => setReview(undefined)} onSave={() => setReview(undefined)} />
    <Modal open={navigationBlocker.status === 'blocked'} title="Leave bulk editor?"
      onCancel={() => navigationBlocker.reset?.()}
      onOk={() => { if (!busy) navigationBlocker.proceed?.(); }}
      okText="Discard and leave" cancelText="Stay in bulk editor" okButtonProps={{ disabled: busy, danger: true }}>
      {busy ? 'Changes are being applied. Stay on this page until verification finishes.' :
        'Your bulk JSON and pending preview will be discarded. Applied changes will remain saved.'}
    </Modal>
  </>;
};
