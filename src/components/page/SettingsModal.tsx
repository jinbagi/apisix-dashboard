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
import { useRouter } from '@tanstack/react-router';
import { Alert, Button, Input, Modal, Space, Typography } from 'antd';
import axios from 'axios';
import { useAtom } from 'jotai';
import { useEffect, useId, useRef, useState } from 'react';

import { API_HEADER_KEY, API_PREFIX } from '@/config/constant';
import { queryClient } from '@/config/global';
import { adminKeyAtom, isSettingsOpenAtom } from '@/stores/global';
import { isRecord } from '@/utils/apisixEditable';
import { sha } from '~build/git';

import classes from './SettingsModal.module.css';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

const ConnectionSettings = ({ initialKey, onClose }: { initialKey: string; onClose: () => void }) => {
  const router = useRouter();
  const [openingKey] = useState(initialKey);
  const [, setAdminKey] = useAtom(adminKeyAtom);
  const [draftKey, setDraftKey] = useState(initialKey);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const pending = useRef<AbortController | null>(null);
  const inputRef = useRef<React.ComponentRef<typeof Input.Password>>(null);
  const id = useId();
  const firstSetup = !openingKey;
  const testing = status === 'testing';
  const connected = status === 'success';

  useEffect(() => () => pending.current?.abort(), []);

  const close = () => {
    pending.current?.abort();
    onClose();
    if (connected) void router.invalidate().catch(() => { /* Route errors retain their inline recovery controls. */ });
  };

  const testConnection = async () => {
    if (pending.current) return;
    const candidate = draftKey.trim();
    if (!candidate) {
      setStatus('error');
      setErrorMsg('Please enter an Admin Key first');
      inputRef.current?.focus();
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setStatus('testing');
    setErrorMsg('');
    try {
      // Test only this draft. The shared interceptor continues using the active key.
      const response = await axios.get(`${API_PREFIX}/routes`, {
        params: { page: 1, page_size: 1 },
        headers: { [API_HEADER_KEY]: candidate },
        signal: controller.signal,
        timeout: 15_000,
      });
      if (controller.signal.aborted) return;
      const data: unknown = response.data;
      const list = isRecord(data) ? data.list : undefined;
      const validList = Array.isArray(list)
        ? list.every((item) => isRecord(item) && isRecord(item.value))
        : isRecord(list) && Object.keys(list).length === 0;
      if (!isRecord(data) || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || !validList ||
        (Array.isArray(list) ? list.length > Number(data.total) : data.total !== 0)) {
        throw new Error('APISIX did not return a valid Routes list. Check the Admin API endpoint.');
      }
      await queryClient.cancelQueries();
      if (controller.signal.aborted) return;
      setAdminKey(candidate);
      setDraftKey(candidate);
      setStatus('success');
      // Refresh cached queries only after the verified key becomes active.
      void queryClient.invalidateQueries();
    } catch (error) {
      if (controller.signal.aborted || axios.isCancel(error)) return;
      setStatus('error');
      if (axios.isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0)) {
        setErrorMsg('Authentication failed - the Admin Key is incorrect');
      } else if (axios.isAxiosError(error) && !error.response) {
        setErrorMsg('Cannot reach APISIX Admin API - check that APISIX is running');
      } else if (error instanceof Error && !axios.isAxiosError(error)) {
        setErrorMsg(error.message);
      } else {
        setErrorMsg('Connection failed - check Admin Key and APISIX status');
      }
      inputRef.current?.focus();
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };

  return <Modal open centered title={firstSetup ? 'Welcome to APISIX Dashboard' : 'Connection settings'}
    onCancel={close} closable={!firstSetup || connected} mask={{ closable: !firstSetup || connected }}
    keyboard={!firstSetup || connected}
    footer={connected ? <Button type="primary" onClick={close}>{firstSetup ? 'Continue to dashboard' : 'Done'}</Button>
      : !firstSetup ? <Button onClick={close}>Cancel</Button> : null}>
    {firstSetup && <Alert type="info" showIcon className={classes.intro}
      message="Connect to your APISIX gateway"
      description="Enter your Admin API key and test the connection to get started." />}
    <label htmlFor={id} className={classes.label}>Admin Key <span aria-hidden="true">*</span></label>
    <Typography.Paragraph id={`${id}-help`} type="secondary" className={classes.help}>
      Use the X-API-KEY from your APISIX configuration. Your active key changes only after a successful test.
    </Typography.Paragraph>
    <Space.Compact className={classes.inputRow}>
      <Input.Password ref={inputRef} id={id} autoFocus value={draftKey} disabled={testing || connected}
        aria-required="true" aria-invalid={status === 'error'}
        aria-describedby={`${id}-help${errorMsg ? ` ${id}-error` : ''}`}
        placeholder="Enter your APISIX Admin Key" autoComplete="off"
        onChange={(event) => { setDraftKey(event.currentTarget.value); setStatus('idle'); setErrorMsg(''); }}
        onPressEnter={() => void testConnection()} status={status === 'error' ? 'error' : undefined} />
      <Button type="primary" loading={testing} disabled={connected} aria-busy={testing} onClick={() => void testConnection()}>
        Test connection
      </Button>
    </Space.Compact>
    {connected && <Alert type="success" showIcon message="Connected successfully" className={classes.feedback}
      description="The verified key is now active. You can continue using the dashboard." />}
    {errorMsg && <Alert id={`${id}-error`} type="error" showIcon message={errorMsg} className={classes.feedback}
      description={openingKey ? 'Your previous active key has not changed.' : 'No key has been saved.'} />}
    {!firstSetup && <details className={classes.about}>
      <summary>About this dashboard</summary>
      <Typography.Text type="secondary">UI Commit SHA</Typography.Text>
      <Typography.Paragraph className={classes.revision} copyable>{sha}</Typography.Paragraph>
    </details>}
  </Modal>;
};

export const SettingsModal = () => {
  const [open, setOpen] = useAtom(isSettingsOpenAtom);
  const [adminKey] = useAtom(adminKeyAtom);
  // Unmounting discards untested input and cancels an in-flight connection test.
  return open ? <ConnectionSettings initialKey={adminKey} onClose={() => setOpen(false)} /> : null;
};
