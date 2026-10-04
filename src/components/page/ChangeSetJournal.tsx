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
import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Typography } from 'antd';
import { useAtom, useAtomValue } from 'jotai';
import { useId, useState } from 'react';

import { changeSetAtom } from '@/stores/changeSets';
import { CHANGE_JOURNAL_KEY, enableChangeJournal, journalVaultAtom, lockChangeJournal, removeChangeJournal, unlockChangeJournal } from '@/utils/changeJournal';
import { getRawDraftDate } from '@/utils/rawDraftStorage';

export const ChangeSetJournal = () => {
  const [state, setState] = useAtom(changeSetAtom);
  const enabled = useAtomValue(journalVaultAtom);
  const [open, setOpen] = useState(false);
  const [archive, setArchive] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const id = useId();
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Journal storage is unavailable. No next write was sent.');
  const show = () => {
    setError(''); setFeedback(''); setPassword(''); setConfirmation('');
    try { setArchive(localStorage.getItem(CHANGE_JOURNAL_KEY)); } catch (cause) { fail(cause); }
    setOpen(true);
  };
  const close = () => { setOpen(false); setPassword(''); setConfirmation(''); };
  const save = async () => {
    if (password !== confirmation) { setError('Journal passwords do not match.'); return; }
    setError(''); setFeedback(''); setState((current) => ({ ...current, busy: true }));
    try {
      await enableChangeJournal(state.drafts, password, archive);
      setArchive(localStorage.getItem(CHANGE_JOURNAL_KEY)); setPassword(''); setConfirmation('');
      setFeedback('Encrypted journal saved. Each resource write will wait for an encrypted checkpoint. The password stays only in memory until you lock or close this tab.');
    } catch (cause) { fail(cause); }
    finally { setState((current) => ({ ...current, busy: false })); }
  };
  const unlock = async () => {
    if (!archive) return;
    setError(''); setFeedback(''); setState((current) => ({ ...current, busy: true }));
    try {
      const drafts = await unlockChangeJournal(archive, password);
      setState({ drafts, plan: null, busy: true, needsRecheck: true });
      setPassword(''); setConfirmation('');
      setFeedback('Journal unlocked. Use Reconcile and preview to re-read every destination. Nothing will resume automatically.');
    } catch (cause) { fail(cause); }
    finally { setState((current) => ({ ...current, busy: false })); }
  };
  return <>
    <Button disabled={state.busy} onClick={show}>{enabled ? 'Encrypted journal enabled' : 'Encrypted journal'}</Button>
    <Modal open={open} title="Resumable import journal" onCancel={close} footer={<Button onClick={close} disabled={state.busy}>Done</Button>}
      closable={!state.busy} mask={{ closable: !state.busy }} keyboard={!state.busy} style={{ top: 24 }} styles={{ body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' } }}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Paragraph style={{ margin: 0 }}>Keep one encrypted journal on this browser for staged Import and RAW changes. Configuration can contain secrets; only encrypted data is stored. The password is never saved. Clearing browser data removes the journal.</Typography.Paragraph>
        {enabled && <Typography.Paragraph style={{ margin: 0 }}>Only checkpointed drafts survive reload. Newly staged items and draft removals are saved on your next Preview or Apply. Choose Encrypt and enable checkpoints to save the current drafts now.</Typography.Paragraph>}
        <Alert type="info" showIcon title="Resume always starts with fresh reads" description="After unlocking or reconnecting, compare actual destinations. Matching completed items are skipped, unchanged baselines require explicit confirmation, and conflicts or protected uncertain values stay blocked. No automatic replay or rollback." />
        <Typography.Text>{archive ? `Stored journal: ${getRawDraftDate(archive)}` : 'No stored journal on this browser.'}</Typography.Text>
        {error && <Alert type="error" showIcon title={error} />}
        {feedback && <Alert type="success" showIcon title={feedback} />}
        <Form layout="vertical">
          <Form.Item label="Journal password" htmlFor={`${id}-password`} style={{ marginBottom: 12 }}>
            <Input.Password id={`${id}-password`} aria-label="Journal password" autoComplete="off" value={password} disabled={state.busy}
              onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" />
          </Form.Item>
          {archive && <Button block disabled={state.busy || !password} loading={state.busy} onClick={unlock}>
            {state.drafts.length ? 'Unlock and replace staged drafts' : 'Unlock journal'}
          </Button>}
          {archive && state.drafts.length > 0 && <Typography.Paragraph type="secondary">Unlocking replaces the {state.drafts.length} current staged drafts with the stored journal.</Typography.Paragraph>}
          <Form.Item label="Confirm password for saving" htmlFor={`${id}-confirm`} style={{ margin: '12px 0' }}>
            <Input.Password id={`${id}-confirm`} aria-label="Confirm journal password" autoComplete="off" value={confirmation} disabled={state.busy}
              onChange={(event) => setConfirmation(event.target.value)} />
          </Form.Item>
          <Button block type="primary" disabled={state.busy || !state.drafts.length || !password || !confirmation} loading={state.busy} onClick={save}>Encrypt and enable checkpoints</Button>
        </Form>
        {enabled && <Popconfirm title="Lock journal and clear staged changes?" description="The encrypted archive stays on this browser. Unlock it with your password to resume after checking the actual targets."
          onConfirm={() => { lockChangeJournal(); setState({ drafts: [], plan: null, busy: false }); close(); }} okText="Lock and clear">
          <Button block disabled={state.busy}>Lock and clear staged changes</Button>
        </Popconfirm>}
        {archive && <Popconfirm title="Remove the encrypted journal?" description="Current in-memory drafts stay available, but checkpoints will stop being stored. This does not undo gateway changes."
          okText="Remove journal" onConfirm={async () => {
            setState((current) => ({ ...current, busy: true }));
            try { await removeChangeJournal(archive); setArchive(null); setFeedback('Encrypted journal removed. Current staged drafts are unchanged.'); setError(''); }
            catch (cause) { fail(cause); }
            finally { setState((current) => ({ ...current, busy: false })); }
          }}><Button danger block disabled={state.busy}>Remove encrypted journal</Button></Popconfirm>}
      </Space>
    </Modal>
  </>;
};
