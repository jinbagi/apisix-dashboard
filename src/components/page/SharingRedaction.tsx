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
import { Alert, Button, Checkbox, Collapse, Input, Modal, Space, Table, Tag, Typography, Upload } from 'antd';
import { useMemo, useRef, useState } from 'react';

import { exportAllResources } from '@/apis/export-import';
import { downloadJson } from '@/utils/downloadJson';
import { findSharingCandidates, parseSharingExport, redactSharingExport, SHARING_MAX_BYTES,type SharingExport } from '@/utils/sharingRedaction';

export function SharingRedaction() {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<SharingExport | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [custom, setCustom] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [copying, setCopying] = useState(false);
  const [search, setSearch] = useState('');
  const generation = useRef(0);
  const analysis = useMemo(() => {
    if (!source) return { candidates: [], error: '', json: '' };
    try {
      const candidates = findSharingCandidates(source, custom);
      return { candidates, error: '', json: JSON.stringify(redactSharingExport(source, selected), null, 2) };
    } catch (cause) { return { candidates: [], error: cause instanceof Error ? cause.message : 'Unable to prepare sharing copy.', json: '' }; }
  }, [source, custom, selected]);
  const clear = () => { setSource(null); setSourceName(''); setSelected([]); setReviewed(false); setError(''); setFeedback(''); setSearch(''); };
  const close = () => { generation.current++; clear(); setCustom(''); setLoading(false); setCopying(false); setOpen(false); };
  const load = async (read: () => Promise<string>, name: string) => {
    const request = ++generation.current;
    clear(); setCustom(''); setCopying(false); setLoading(true);
    try {
      const parsed = parseSharingExport(await read());
      if (request !== generation.current) return;
      setSource(parsed); setSourceName(name); setSelected(findSharingCandidates(parsed).map((item) => item.path));
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'The configuration could not be loaded. Retry or choose a local export.');
    } finally { if (request === generation.current) setLoading(false); }
  };
  const invalidateReview = () => { generation.current++; setReviewed(false); setFeedback(''); setError(''); setCopying(false); };
  const changeCustom = (text: string) => {
    setCustom(text); invalidateReview();
    try { if (source) setSelected(findSharingCandidates(source, text).map((item) => item.path)); }
    catch { setSelected([]); }
  };
  const ready = source !== null && !loading && !analysis.error && reviewed;
  const download = () => {
    if (!ready) return;
    try { downloadJson(JSON.parse(analysis.json), 'apisix-redacted-sharing-copy.json'); setFeedback('Redacted sharing copy downloaded.'); }
    catch { setError('Download failed. Retry, or copy the reviewed JSON.'); }
  };
  const copy = async () => {
    if (!ready) return;
    const request = generation.current;
    setCopying(true);
    try { await navigator.clipboard.writeText(analysis.json); if (request === generation.current) setFeedback('Redacted sharing copy copied to clipboard.'); }
    catch { if (request === generation.current) setError('Clipboard access failed. Allow clipboard access or download the reviewed copy.'); }
    finally { if (request === generation.current) setCopying(false); }
  };
  return <>
    <Button size="large" onClick={() => setOpen(true)}>Prepare redacted copy</Button>
    <Modal open={open} title="Prepare a sharing copy" width={1040} onCancel={close} destroyOnHidden
      style={{ top: 24, paddingBottom: 0 }}
      styles={{ container: { maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column' },
        header: { flexShrink: 0 }, footer: { flexShrink: 0 }, body: { minHeight: 0, overflowY: 'auto' } }}
      footer={<Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Button onClick={close}>Close sharing preview</Button>
        <Button disabled={!ready} loading={copying} onClick={() => void copy()}>Copy redacted JSON</Button>
        <Button type="primary" disabled={!ready} onClick={download}>Download sharing copy</Button>
      </Space>}>
      <Alert type="info" showIcon title="Review before sharing — this copy cannot be imported"
        description="Known sensitive fields are selected by default. Unknown plugins, URLs, free text and code may still contain secrets. Add custom field names and review retained content. The source configuration is unchanged." />
      <Space wrap style={{ margin: '16px 0' }}>
        <Upload accept=".json" showUploadList={false} beforeUpload={(file) => {
          void load(async () => {
            if (file.size > SHARING_MAX_BYTES) throw new Error('Choose an export file smaller than 10 MiB.');
            return file.text();
          }, file.name); return false;
        }}><Button loading={loading}>Choose export file</Button></Upload>
        <Button loading={loading} onClick={() => void load(async () => {
          try { return JSON.stringify(await exportAllResources()); }
          catch { throw new Error('Current configuration could not be loaded. Retry or choose a local export file.'); }
        }, 'Current gateway export')}>Load current configuration</Button>
      </Space>
      {(error || analysis.error) && <Alert role="alert" type="error" showIcon title={error || analysis.error}
        action={error && source ? <Button size="small" onClick={() => setError('')}>Dismiss error</Button> : undefined} />}
      {feedback && <Alert role="status" type="success" title={feedback} />}
      {source && <>
        <Typography.Paragraph style={{ marginTop: 12 }}><strong>Source:</strong> {sourceName} <Tag color="orange">Incomplete sharing copy</Tag></Typography.Paragraph>
        {Array.isArray(source.skippedResources) && source.skippedResources.length > 0 && <Alert type="warning" title="The original export has skipped collections. This sharing copy also remains incomplete." />}
        <Typography.Paragraph style={{ marginTop: 12, marginBottom: 4 }}>Custom field names (comma or newline separated; exact names, case insensitive)</Typography.Paragraph>
        <Input.TextArea aria-label="Custom sensitive field names" value={custom} rows={2} onChange={(event) => changeCustom(event.target.value)}
          placeholder="internal_password, x-company-token" />
        <Typography.Paragraph type="secondary">Changing custom rules reselects all matching fields. Values are replaced with [REDACTED], including arrays or objects selected as a whole.</Typography.Paragraph>
        <Space wrap style={{ marginBottom: 8 }}>
          <Typography.Text strong>{selected.length} of {analysis.candidates.length} matching fields selected</Typography.Text>
          <Button size="small" onClick={() => { setSelected(analysis.candidates.map((item) => item.path)); invalidateReview(); }}>Select all matches</Button>
          <Button size="small" onClick={() => { setSelected([]); invalidateReview(); }}>Clear selection</Button>
        </Space>
        <Input.Search aria-label="Filter sensitive field paths" placeholder="Filter field paths" value={search} onChange={(event) => setSearch(event.target.value)} style={{ marginBottom: 8 }} />
        <Table size="small" rowKey="path" dataSource={analysis.candidates.filter((item) => item.path.toLowerCase().includes(search.toLowerCase()))}
          pagination={{ pageSize: 8, hideOnSinglePage: true, showSizeChanger: false }}
          locale={{ emptyText: 'No matching fields. Add custom names and review the JSON; this does not mean the file has no secrets.' }}
          columns={[
            { title: 'Redact', width: 72, render: (_, row) => <Checkbox aria-label={`Redact ${row.path}`} checked={selected.includes(row.path)} onChange={(event) => {
              setSelected((previous) => event.target.checked ? [...previous, row.path] : previous.filter((path) => path !== row.path)); invalidateReview();
            }} /> },
            { title: 'Field path', dataIndex: 'path', render: (path: string) => <Typography.Text code style={{ overflowWrap: 'anywhere' }}>{path}</Typography.Text> },
            { title: 'Match', dataIndex: 'reason', responsive: ['sm'] },
          ]} />
        <Collapse style={{ marginTop: 12 }} items={[{ key: 'json', label: 'Preview redacted JSON', children: <pre aria-label="Redacted JSON preview" tabIndex={0}
          style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}>{analysis.json}</pre> }]} />
        <Checkbox style={{ margin: '16px 0' }} checked={reviewed} onChange={(event) => setReviewed(event.target.checked)}>
          I reviewed the selected fields and remaining content for secrets before sharing.
        </Checkbox>
      </>}
    </Modal>
  </>;
}
