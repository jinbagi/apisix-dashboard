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
import { Alert, Button, Checkbox, Collapse, Modal, Space, Table, Tag, Typography } from 'antd';
import { useRef, useState } from 'react';

import { type CloneDraft, type ClonePreview, prepareCloneDrafts, previewDependencyClone, suggestCloneMappings } from '@/apis/dependency-clone';
import { dependencyExportScope, prepareDependencyExport, supportsDependencyExport } from '@/apis/dependency-export';
import type { ExportData } from '@/apis/export-import';
import type { ImportPreviewItem } from '@/apis/import-preview';
import { JsonChangeReview } from '@/components/form/JsonChangeReview';
import { EnvironmentIdMapping } from '@/components/page/EnvironmentIdMapping';

const scope = { pluginReferences: true, graphqlCostDecorations: true };
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Unable to prepare the clone. Refresh and try again.';

export const DependencyClone = ({ apiBase, selectedIds, disabled, onStage }: {
  apiBase: string; selectedIds: string[]; disabled: boolean; onStage: (drafts: CloneDraft[]) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<ExportData>();
  const [ids, setIds] = useState<string[]>([]);
  const [mappings, setMappings] = useState('{}');
  const [activate, setActivate] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [preview, setPreview] = useState<ClonePreview>();
  const [diff, setDiff] = useState<ImportPreviewItem>();
  const [error, setError] = useState('');
  const [staged, setStaged] = useState(0);
  const revision = useRef(0);
  if (!supportsDependencyExport(apiBase)) return null;
  const invalidate = () => { ++revision.current; setPreview(undefined); setReviewed(false); setStaged(0); setError(''); setLoading(false); setDiff(undefined); };
  const close = () => { invalidate(); setOpen(false); setSource(undefined); setMappings('{}'); setActivate(false); };
  const readSource = async (selection: string[]) => {
    invalidate(); const current = revision.current; setLoading(true); setSource(undefined); setActivate(false);
    try {
      const bundle = await prepareDependencyExport(apiBase, selection, scope);
      if (current !== revision.current) return;
      if (bundle.blocked) throw new Error(bundle.rows.filter((row) => row.status !== 'Included').map((row) => `${row.key}: ${row.error}`).join('; '));
      const text = suggestCloneMappings(bundle.data);
      setSource(bundle.data); setMappings(text);
      const result = await previewDependencyClone(bundle.data, text);
      if (current === revision.current) setPreview(result);
    } catch (cause) { if (current === revision.current) setError(message(cause)); }
    finally { if (current === revision.current) setLoading(false); }
  };
  const compare = async (stage = false) => {
    if (!source) return;
    const current = ++revision.current; setLoading(true); setError(''); setStaged(0);
    try {
      const result = stage ? await prepareCloneDrafts(source, mappings, activate) : { preview: await previewDependencyClone(source, mappings, activate), drafts: [] };
      if (current !== revision.current) return;
      setPreview(result.preview);
      if (stage) {
        if (!result.drafts.length) { setReviewed(false); setError('A destination or reference changed. Review the blocked resources before staging.'); }
        else { onStage(result.drafts); setStaged(result.drafts.length); setReviewed(false); }
      }
    } catch (cause) { if (current === revision.current) { setError(message(cause)); setReviewed(false); } }
    finally { if (current === revision.current) setLoading(false); }
  };
  const blocked = preview?.rows.filter((row) => row.status !== 'New').length ?? 0;
  return <>
    <Button disabled={disabled} onClick={() => { setOpen(true); setIds([...selectedIds]); void readSource([...selectedIds]); }}>Clone with dependencies</Button>
    <Modal open={open} title="Clone with dependencies" width={1040} onCancel={close} destroyOnHidden style={{ top: 24 }}
      styles={{ container: { maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column' }, header: { flexShrink: 0 }, body: { minHeight: 0, overflowY: 'auto' }, footer: { flexShrink: 0 } }}
      footer={<Space wrap><Button onClick={close}>Close clone</Button>
        <Button loading={loading} disabled={!source || loading || !!staged} onClick={() => void compare()}>Check destinations</Button>
        <Button type="primary" loading={loading} disabled={loading || !preview || !preview.rows.length || !!blocked || !reviewed || !!staged} onClick={() => void compare(true)}>Stage clone</Button></Space>}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Paragraph style={{ margin: 0 }}>Create a separate copy of {ids.length} selected resource(s) and their supported dependencies. Choose new IDs, review the configuration, then stage the whole bundle for application in Change sets.</Typography.Paragraph>
        <Alert type="info" showIcon title="Clone scope" description={dependencyExportScope(scope)} />
        <Typography.Text type="secondary">Unknown plugin references and embedded endpoints remain unchanged. This is a snapshot of sequential reads. Review those settings before applying.</Typography.Text>
        <Button disabled={loading} onClick={() => void readSource(ids)}>Reload source and reset clone</Button>
        {error && <Alert type="error" showIcon title="Clone needs attention" description={error} />}
        {!!staged && <Alert type="success" showIcon title={`${staged} resources staged; nothing applied yet`} description="Open Change sets from the sidebar to review and apply. Create-only destinations are checked again before each write. This draft stays in memory until the page reloads." />}
        {source && <>
          <Collapse defaultActiveKey={['mapping']} items={[{ key: 'mapping', label: 'Destination IDs', children: <EnvironmentIdMapping data={source} text={mappings} disabled={loading || !!staged} onChange={(text) => { invalidate(); setMappings(text); }} /> }]} />
          {!!source.resources.routes.length && <Checkbox checked={activate} disabled={loading || !!staged} onChange={(event) => { invalidate(); setActivate(event.target.checked); }}>Enable cloned HTTP Routes when applied (disabled by default)</Checkbox>}
          {!!source.resources.streamRoutes.length && <Alert type="warning" showIcon title="Review Stream Route matching" description="Stream Routes have no cloned disabled state here. Their matching fields stay the same, so they can overlap active traffic when applied. Review server ports, addresses, SNI and priority in Change sets before applying." />}
        </>}
        {preview && <>
          <div role="status">{preview.rows.length} resources · {blocked} blocked destinations</div>
          <Table size="small" rowKey="key" dataSource={preview.rows} pagination={{ pageSize: 6, showSizeChanger: false }} columns={[{
            title: 'Source → clone', key: 'resource', render: (_, row) => <Space orientation="vertical" size={4} style={{ width: '100%', overflowWrap: 'anywhere' }}>
              <Typography.Text code>{row.sourceUrl}</Typography.Text><Typography.Text>→ {row.url}</Typography.Text>
              <Space wrap><Tag color={row.status === 'New' ? 'green' : 'red'}>{row.status === 'New' ? 'Create only' : 'Blocked'}</Tag>
                {row.sourceBody && row.after && <Button size="small" onClick={() => setDiff(row)}>Review JSON: {row.id}</Button>}</Space>
              {row.error && <Typography.Text type="danger">{row.error}</Typography.Text>}
            </Space>,
          }]} />
          <Checkbox checked={reviewed} disabled={loading || !!blocked || !!staged} onChange={(event) => setReviewed(event.target.checked)}>I reviewed the destination IDs, JSON, unchanged matching fields and reference scope.</Checkbox>
        </>}
      </Space>
    </Modal>
    <JsonChangeReview open={!!diff} original={JSON.stringify(diff?.sourceBody, null, 2) ?? ''} modified={JSON.stringify(diff?.after, null, 2) ?? ''}
      title="Review clone JSON" description={`${diff?.sourceUrl ?? ''} → ${diff?.url ?? ''}. Review references, matching fields and HTTP Route status.`}
      confirmText="Done reviewing" onCancel={() => setDiff(undefined)} onSave={() => setDiff(undefined)} />
  </>;
};
