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
import { Alert, Button, Input, Modal, Popconfirm, Space, Typography } from 'antd';
import { useState } from 'react';

import { JsonChangeReview } from '@/components/form/JsonChangeReview';
import { req } from '@/config/req';
import { isRecord, stripPatchReadonlyFields } from '@/utils/apisixEditable';
import { decryptRawDraft, encryptRawDraft, getRawDraftDate, rawDraftKey, type RawDraftSnapshot } from '@/utils/rawDraftStorage';

type Props = {
  api: string;
  snapshot: RawDraftSnapshot;
  disabled: boolean;
  onRestore: (draft: RawDraftSnapshot, latest: Record<string, unknown>) => void;
};

export const LocalRawDraft = ({ api, snapshot, disabled, onRestore }: Props) => {
  const [open, setOpen] = useState(false);
  const [stored, setStored] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [review, setReview] = useState<{ draft: RawDraftSnapshot; latest: Record<string, unknown> } | null>(null);
  const storageKey = rawDraftKey(api);
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Browser draft storage is unavailable.');
  const close = () => {
    setOpen(false); setPassword(''); setConfirmation(''); setReview(null);
  };
  const show = () => {
    setError(''); setFeedback(''); setPassword(''); setConfirmation('');
    try { setStored(localStorage.getItem(storageKey)); } catch (cause) { fail(cause); }
    setOpen(true);
  };
  const save = async () => {
    if (password !== confirmation) { setError('Draft passwords do not match.'); return; }
    setBusy(true); setError(''); setFeedback('');
    try {
      const encoded = await encryptRawDraft(api, snapshot, password);
      if (localStorage.getItem(storageKey) !== stored) throw new Error('The stored draft changed in another tab. Close and reopen Drafts to review it.');
      localStorage.setItem(storageKey, encoded);
      setStored(encoded); setPassword(''); setConfirmation('');
      setFeedback('Encrypted draft saved on this browser. Nothing was sent to APISIX.');
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    if (!stored) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      const draft = await decryptRawDraft(api, stored, password);
      const response = await req.get(api);
      if (!isRecord(response.data?.value)) throw new Error('Cannot compare the draft: the latest resource is unavailable.');
      setReview({ draft, latest: response.data.value });
      setPassword(''); setConfirmation('');
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  };
  const remove = () => {
    try {
      if (localStorage.getItem(storageKey) !== stored) throw new Error('The stored draft changed in another tab. Close and reopen Drafts to review it.');
      localStorage.removeItem(storageKey); setStored(null); setError(''); setFeedback('Stored draft removed. Current editor content is unchanged.');
    } catch (cause) { fail(cause); }
  };
  return (
    <>
      <Button onClick={show} disabled={disabled}>Drafts</Button>
      <Modal title="Local RAW draft" open={open && !review} onCancel={close} footer={null}
        closable={!busy} maskClosable={!busy} keyboard={!busy} destroyOnHidden>
        <Typography.Paragraph>
          Keep one encrypted draft for this resource on this browser. The password is never stored.
          You need it to recover the draft after reopening the browser. Clearing browser data removes the draft.
        </Typography.Paragraph>
        <Typography.Paragraph code>{api}</Typography.Paragraph>
        <Typography.Paragraph>
          {stored ? `Stored draft: ${getRawDraftDate(stored)}` : 'No stored draft for this resource.'}
        </Typography.Paragraph>
        {!crypto.subtle && <Alert type="warning" message="Encrypted drafts require HTTPS or localhost." />}
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
        {feedback && <Alert type="success" showIcon message={feedback} style={{ marginBottom: 12 }} />}
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Input.Password aria-label="Draft password" placeholder="Draft password (at least 12 characters)"
            autoComplete="off" value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
          {stored && <Button block onClick={restore} loading={busy} disabled={!password || !crypto.subtle}>Unlock and compare</Button>}
          <Input.Password aria-label="Confirm draft password" placeholder="Confirm password to save or replace"
            autoComplete="off" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} />
          <Space wrap>
            <Popconfirm title="Replace the stored draft?" description="The previous stored draft will be replaced."
              disabled={!stored} onConfirm={save}>
              <Button type="primary" loading={busy} disabled={!crypto.subtle || password.length < 12 || !confirmation}
                onClick={() => { if (!stored) void save(); }}>
                {stored ? 'Replace stored draft' : 'Save encrypted draft'}
              </Button>
            </Popconfirm>
            {stored && <Popconfirm title="Remove this stored draft?" onConfirm={remove}>
              <Button danger disabled={busy}>Remove stored draft</Button>
            </Popconfirm>}
            <Button disabled={busy} onClick={close}>Close</Button>
          </Space>
          <Typography.Text type="secondary">Saving a local draft does not apply it to APISIX. Restoring replaces the current editor after review. Stored drafts remain until removed or replaced.</Typography.Text>
        </Space>
      </Modal>
      <JsonChangeReview open={review !== null} title="Restore local draft"
        description="Latest server configuration is on the left; the stored draft is on the right. Restoring replaces the current editor only. Save Changes will check for concurrent changes before applying your edits."
        original={review ? JSON.stringify(stripPatchReadonlyFields(review.latest), null, 2) : ''}
        modified={review?.draft.value ?? ''} confirmText="Restore into editor"
        onCancel={() => setReview(null)} onSave={() => {
          if (review) onRestore(review.draft, review.latest);
          close();
        }} />
    </>
  );
};

