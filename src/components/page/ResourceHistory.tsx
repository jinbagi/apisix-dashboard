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
import { Alert, Button, Grid, Input, List, Modal, Popconfirm, Space, Table, Typography } from 'antd';
import { useAtom } from 'jotai';
import { useState } from 'react';
import { z } from 'zod';

import { prepareHistoryRestore } from '@/apis/resource-history';
import { JsonChangeReview } from '@/components/form/JsonChangeReview';
import { HISTORY_LIMIT, historyEntrySchema, historyRestoreReason, resourceHistoryAtom, type ResourceHistoryEntry } from '@/stores/resourceHistory';
import { decryptRawDraft, encryptRawDraft, type RawDraftSnapshot } from '@/utils/rawDraftStorage';

const ARCHIVE_KEY = 'resource-history:v1';
const ARCHIVE_CONTEXT = '/dashboard-local-history';
export const ResourceHistory = ({ api, disabled = false, onRestore }: {
  api?: string; disabled?: boolean;
  onRestore?: (draft: RawDraftSnapshot, latest: Record<string, unknown>) => void;
}) => {
  const screens = Grid.useBreakpoint();
  const [entries, setEntries] = useAtom(resourceHistoryAtom);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [archive, setArchive] = useState<string | null>(null);
  const [compared, setCompared] = useState<ResourceHistoryEntry>();
  const [restored, setRestored] = useState<Awaited<ReturnType<typeof prepareHistoryRestore>>>();
  const rows = entries.filter((entry) => !api || entry.api === api);
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'History operation failed.');
  const close = () => { setOpen(false); setPassword(''); setConfirmation(''); setCompared(undefined); setRestored(undefined); };
  const show = () => {
    setError(''); setFeedback(''); setPassword(''); setConfirmation('');
    try { setArchive(localStorage.getItem(ARCHIVE_KEY)); } catch (cause) { fail(cause); }
    setOpen(true);
  };
  const saveArchive = async () => {
    if (password !== confirmation) { setError('History passwords do not match.'); return; }
    setBusy(true); setError(''); setFeedback('');
    try {
      const encoded = await encryptRawDraft(ARCHIVE_CONTEXT, { original: '{}', value: JSON.stringify(entries) }, password);
      if (localStorage.getItem(ARCHIVE_KEY) !== archive) throw new Error('History archive changed in another tab. Reopen history first.');
      localStorage.setItem(ARCHIVE_KEY, encoded); setArchive(encoded); setPassword(''); setConfirmation('');
      setFeedback('Encrypted history saved on this browser. The password is not stored.');
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  };
  const unlock = async () => {
    if (!archive) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      const decoded = await decryptRawDraft(ARCHIVE_CONTEXT, archive, password);
      const unlocked = z.array(historyEntrySchema).max(HISTORY_LIMIT).parse(JSON.parse(decoded.value));
      setEntries((current) => [...new Map([...unlocked, ...current].map((entry) => [entry.id, entry])).values()]
        .sort((a, b) => b.at - a.at).slice(0, HISTORY_LIMIT));
      setPassword(''); setConfirmation(''); setFeedback('History unlocked into this tab.');
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  };
  const prepareRestore = async (entry: ResourceHistoryEntry) => {
    setBusy(true); setError('');
    try { setRestored(await prepareHistoryRestore(entry)); }
    catch (cause) { fail(cause); } finally { setBusy(false); }
  };
  const entryActions = (row: ResourceHistoryEntry) => <Space wrap>
    <Button disabled={busy} onClick={() => setCompared(row)}>Compare change</Button>
    {onRestore && <Button disabled={busy || !!historyRestoreReason(row)} onClick={() => void prepareRestore(row)}>Restore previous values</Button>}
  </Space>;
  const entrySummary = (row: ResourceHistoryEntry) => <Space orientation="vertical" size={0}>
    <Typography.Text>{row.operation} · {row.source === 'legacy' ? 'legacy RAW/bulk' : row.source}</Typography.Text>
    <Typography.Text type="secondary">{row.verification === 'readable' ? 'Readable fields verified' : 'Verified'}</Typography.Text>
    {historyRestoreReason(row) && <Typography.Text type="secondary">{historyRestoreReason(row)}</Typography.Text>}
  </Space>;
  return <>
    <Button disabled={disabled} onClick={show}>Change history</Button>
    <Modal title="Resource change history" open={open && !compared && !restored} width={1000} onCancel={close}
      style={screens.md ? undefined : { top: 16 }} styles={{ body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' } }}
      closable={!busy} mask={{ closable: !busy }} keyboard={!busy} footer={<Button disabled={busy} onClick={close}>Close history</Button>} destroyOnHidden>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Paragraph>
          Last {HISTORY_LIMIT} verified changes from RAW, bulk RAW, forms, import, and supported API Console writes made in this tab. This is local history, not a gateway audit log.
          Reloading clears memory unless you save an encrypted archive. Archives include configuration values and may contain secrets.
          Open a resource RAW editor to restore an update. Create, delete, and protected-field events are view only. Unverified writes are excluded. This read-before/write/read-after history is not an atomic server audit trail.
        </Typography.Paragraph>
        {api && <Typography.Text code>{api}</Typography.Text>}
        {error && <Alert type="error" showIcon title={error} />}
        {feedback && <Alert type="success" showIcon title={feedback} />}
        {screens.md ? <Table size="small" rowKey="id" dataSource={rows} pagination={{ pageSize: 5 }} scroll={{ x: 900 }} columns={[
          { title: 'Verified at', width: 160, key: 'at', render: (_, row) => new Date(row.at).toLocaleString() },
          { title: 'Resource', width: 240, dataIndex: 'api' },
          { title: 'Change', width: 270, key: 'change', render: (_, row) => entrySummary(row) },
          { title: 'Actions', key: 'actions', render: (_, row) => entryActions(row) },
        ]} /> : <List dataSource={rows} pagination={{ pageSize: 5, size: 'small' }} renderItem={(row) =>
          <List.Item key={row.id}>
            <Space orientation="vertical" size="small" style={{ width: '100%' }}>
              <Typography.Text code style={{ overflowWrap: 'anywhere' }}>{row.api}</Typography.Text>
              <Typography.Text type="secondary">{new Date(row.at).toLocaleString()}</Typography.Text>
              {entrySummary(row)}
              {entryActions(row)}
            </Space>
          </List.Item>
        } />}
        <Typography.Text strong>Encrypted archive / all resources in this tab</Typography.Text>
        <Input.Password aria-label="History password" placeholder="History password (at least 12 characters)" autoComplete="off"
          value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
        {archive && <Button disabled={busy || !password} onClick={() => void unlock()}>Unlock saved history</Button>}
        <Input.Password aria-label="Confirm history password" placeholder="Confirm password to save archive" autoComplete="off"
          value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} />
        <Space wrap>
          <Popconfirm title="Replace the saved history archive?" disabled={!archive} onConfirm={saveArchive}>
            <Button disabled={busy || !entries.length || password.length < 12 || !confirmation}
              onClick={() => { if (!archive) void saveArchive(); }}>Save encrypted history</Button>
          </Popconfirm>
          <Popconfirm title="Clear history in this tab?" onConfirm={() => setEntries([])}>
            <Button disabled={busy || !entries.length}>Clear session history</Button>
          </Popconfirm>
          {archive && <Popconfirm title="Delete the encrypted history archive?" onConfirm={() => {
            try {
              if (localStorage.getItem(ARCHIVE_KEY) !== archive) throw new Error('History archive changed in another tab. Reopen history first.');
              localStorage.removeItem(ARCHIVE_KEY); setArchive(null); setFeedback('Saved archive deleted.');
            } catch (cause) { fail(cause); }
          }}><Button danger disabled={busy}>Delete saved history</Button></Popconfirm>}
        </Space>
      </Space>
    </Modal>
    <JsonChangeReview open={!!compared} title="Recorded resource change" description="Recorded values before the operation are on the left; values after it are on the right. null means the resource did not exist. Protected fields may be masked by the gateway."
      original={JSON.stringify(compared ? compared.before : {}, null, 2)} modified={JSON.stringify(compared ? compared.after : {}, null, 2)}
      confirmText="Back to history" onCancel={() => setCompared(undefined)} onSave={() => setCompared(undefined)} />
    <JsonChangeReview open={!!restored} title="Restore previous resource values"
      description="Latest server values are on the left. Only this recorded operation's changes are reversed on the right. Unrelated server changes are preserved. Restoring replaces your current editor; Save Changes rechecks conflicts before applying."
      original={restored?.original ?? ''} modified={restored?.value ?? ''} confirmText="Restore into editor"
      onCancel={() => setRestored(undefined)} onSave={() => {
        if (restored && onRestore) onRestore(restored, restored.latest);
        close();
      }} />
  </>;
};
