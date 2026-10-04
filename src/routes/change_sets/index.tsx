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
import { createFileRoute, Link, useBlocker } from '@tanstack/react-router';
import { Alert, Button, Card, Collapse, Empty, Modal, Popconfirm, Space, Tag, Typography } from 'antd';
import { useAtom } from 'jotai';
import { useState } from 'react';

import { applyChangeSet, type ChangeSetRow, previewChangeSet } from '@/apis/change-sets';
import { RESOURCE_LABELS } from '@/apis/export-import';
import { JsonChangeReview } from '@/components/form/JsonChangeReview';
import PageHeader from '@/components/page/PageHeader';
import { queryClient } from '@/config/global';
import { changeSetAtom, changeUrl } from '@/stores/changeSets';

function ChangeSetsPage() {
  const [state, setState] = useAtom(changeSetAtom);
  const [error, setError] = useState('');
  const [review, setReview] = useState<ChangeSetRow | null>(null);
  const [confirming, setConfirming] = useState(false);
  const blocker = useBlocker({ shouldBlockFn: () => state.busy, enableBeforeUnload: false, withResolver: true });
  const preview = async () => {
    setError(''); setState((current) => ({ ...current, busy: true, plan: null }));
    try {
      const plan = await previewChangeSet(state.drafts);
      setState((current) => ({ ...current, plan }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load the destinations.'); }
    finally { setState((current) => ({ ...current, busy: false })); }
  };
  const apply = async () => {
    if (!state.plan) return;
    setConfirming(false); setError(''); setState((current) => ({ ...current, busy: true }));
    try {
      await applyChangeSet(state.plan, (updated, outcome) => setState((current) => ({ ...current,
        plan: current.plan?.map((row) => row.url === updated.url ? updated : row) ?? null,
        drafts: outcome ? current.drafts.map((draft) => changeUrl(draft) === updated.url ? { ...draft, outcome, detail: updated.detail } : draft) : current.drafts,
      })));
      await queryClient.invalidateQueries();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Change-set execution stopped.'); }
    finally { setState((current) => ({ ...current, busy: false })); }
  };
  const remove = (url: string) => setState((current) => ({ ...current, drafts: current.drafts.filter((draft) => changeUrl(draft) !== url), plan: null }));
  const ready = state.plan?.filter((row) => !row.draft.outcome && ['New', 'Changed'].includes(row.status)).length ?? 0;
  const blocked = state.plan?.some((row) => row.status === 'Blocked' || row.result === 'Blocked' || row.result === 'Uncertain');
  const attempted = state.plan?.some((row) => row.result !== undefined);
  const needsPreview = state.plan?.some((row) => row.result !== undefined && !row.draft.outcome);
  return <>
    <PageHeader title="Change sets" desc="Review related changes before applying them" />
    <Space direction="vertical" size="middle" style={{ width: '100%', minWidth: 0 }}>
      <Alert type="info" showIcon message="Drafts stay in this tab"
        description={<>Stage changes from RAW or an Import preview. Reloading or closing this tab clears them. <Link to="/export_import">Open Import / Export</Link></>} />
      <Collapse size="small" items={[{ key: 'scope', label: 'How staging and verification work', children: <>
        <Typography.Paragraph>Nothing is applied until you preview and confirm. Changes use explicit-ID PUT: create a new resource or replace its writable configuration. Absent fields may be removed. Create-only drafts must still target a missing resource.</Typography.Paragraph>
        <Typography.Paragraph>References checked: native Service, Upstream, Plugin Config, Consumer Group and child owners; grpc-transcode Proto and traffic-split Upstream IDs. Other plugin references are not inferred.</Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 0 }}>Writes are sequential and can partially succeed; execution stops at the first failure. Fresh reads detect observed conflicts, but are not an atomic transaction or lock.</Typography.Paragraph>
      </> }]} />
      {error && <Alert type="error" showIcon message={error} />}
      <Space wrap>
        <Button onClick={preview} loading={state.busy} disabled={!state.drafts.length}>Preview destinations</Button>
        <Button type="primary" onClick={() => setConfirming(true)} disabled={state.busy || !ready || !!blocked || needsPreview}>Apply {ready || ''} changes</Button>
        <Typography.Text>{state.drafts.length} staged · {state.drafts.filter((draft) => draft.outcome === 'verified').length} verified</Typography.Text>
      </Space>
      {attempted && <Alert type={blocked ? 'warning' : 'success'} showIcon message={blocked ? 'Execution stopped. Remaining items were not applied.' : 'Execution finished.'}
        description="Each outcome is shown below. Previously verified items will not be sent again. Uncertain writes require inspection before discarding or restaging. Preview again to review remaining items." />}
      {!state.drafts.length && <Empty description="No staged changes yet" />}
      {(state.plan ?? state.drafts.map((draft) => ({ draft, url: changeUrl(draft), resourceType: draft.resourceType }))).map((entry) => {
        const row = 'status' in entry ? entry as ChangeSetRow : undefined;
        const draft = entry.draft;
        return <Card key={entry.url} size="small" styles={{ body: { overflowWrap: 'anywhere' } }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space wrap><Typography.Text strong>{row?.order ? `${row.order}. ` : ''}{RESOURCE_LABELS[entry.resourceType]}</Typography.Text>
              <Tag color={row?.status === 'Blocked' || row?.result === 'Uncertain' || row?.result === 'Blocked' ? 'red' : draft.outcome === 'verified' ? 'green' : 'blue'}>{row?.result ?? row?.status ?? (draft.outcome === 'verified' ? 'Previously verified' : 'Staged')}</Tag>
              {draft.baseline === null && <Tag>Create only</Tag>}
            </Space>
            <Typography.Text code style={{ overflowWrap: 'anywhere' }}>{entry.url}</Typography.Text>
            {row?.error && <Typography.Text type="danger">{row.error}</Typography.Text>}
            {(row?.detail ?? draft.detail) && <Typography.Text>{row?.detail ?? draft.detail}</Typography.Text>}
            {row && <Typography.Text type="secondary">{row.dependencies.length ? 'Required resources:' : 'No supported external resource references found.'}</Typography.Text>}
            {row?.dependencies.map((dependency, index) => <div key={`${dependency.field}:${index}`}>
              <Typography.Text code>{dependency.field}</Typography.Text> → {dependency.url} <Tag>{dependency.staged ? 'Staged first' : 'Existing destination'}</Tag>
            </div>)}
            <Space wrap>
              {row?.after && <Button size="small" onClick={() => setReview(row)}>Compare JSON</Button>}
              <Popconfirm title="Remove this staged item?" description={draft.outcome ? 'This only removes the local draft. Any gateway changes remain applied.' : 'The local draft will be removed. No request is sent to APISIX.'}
                onConfirm={() => remove(entry.url!)} okText="Remove" disabled={state.busy}>
                <Button size="small" disabled={state.busy}>Remove draft</Button>
              </Popconfirm>
            </Space>
          </Space>
        </Card>;
      })}
    </Space>
    <JsonChangeReview open={review !== null} title="Change-set JSON comparison" description={`${review?.url ?? ''}: current writable configuration → replacement PUT payload. Absent fields may be removed.`}
      original={JSON.stringify(review?.before ?? {}, null, 2)} modified={JSON.stringify(review?.after ?? {}, null, 2)}
      confirmText="Back to change set" onCancel={() => setReview(null)} onSave={() => setReview(null)} />
    <Modal title="Apply change set" open={confirming} onCancel={() => setConfirming(false)} onOk={apply} okText={`Apply ${ready} changes`}>
      Apply the reviewed PUT payloads in the displayed dependency order. Each destination is checked again and read-back verified.
      Applied items remain applied if a later item fails. Protected values can only be verified through their readable fields.
    </Modal>
    <Modal title="Change set in progress" open={blocker.status === 'blocked'} onCancel={() => blocker.reset?.()}
      footer={<Button onClick={() => blocker.reset?.()}>Keep waiting</Button>}>Wait for the current operation to finish before leaving.</Modal>
  </>;
}

export const Route = createFileRoute('/change_sets/')({ component: ChangeSetsPage });
