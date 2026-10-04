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
import { Alert, Button, Checkbox, Collapse, Grid, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';

import { readRoutesForOverlap } from '@/apis/route-overlap';
import { RawDrawer } from '@/components/page/RawDrawer';
import { HTTP_ROUTERS, type MatchResult, type PreviewRequest, previewRequests, validatePreviewRequest } from '@/utils/requestPreview';
import type { SavedRoute } from '@/utils/routeOverlap';

export const RequestMatchPreview = () => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<PreviewRequest>({ method: 'GET', host: '', path: '/', router: '' });
  const [result, setResult] = useState<{ rows: MatchResult[]; at: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showExcluded, setShowExcluded] = useState(false);
  const [editing, setEditing] = useState<SavedRoute>();
  const controller = useRef<AbortController | undefined>(undefined);
  const screens = Grid.useBreakpoint();
  useEffect(() => () => controller.current?.abort(), []);
  const change = (patch: Partial<PreviewRequest>) => { setInput((current) => ({ ...current, ...patch })); setResult(undefined); setError(''); };
  const preview = async () => {
    setResult(undefined); const errors = validatePreviewRequest(input); if (errors.length) { setError(errors.join(' ')); return; }
    controller.current?.abort(); const pending = new AbortController(); controller.current = pending;
    setLoading(true); setError('');
    try {
      const routes = await readRoutesForOverlap(pending.signal);
      if (!pending.signal.aborted) setResult({ rows: previewRequests(routes, input), at: new Date().toLocaleTimeString() });
    } catch (cause) { if (!pending.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not read Routes.'); }
    finally { if (!pending.signal.aborted) setLoading(false); }
  };
  const close = () => { controller.current?.abort(); setLoading(false); setOpen(false); };
  const rows = result?.rows.filter((row) => showExcluded || row.status === 'Candidate' || row.status === 'Needs runtime check') ?? [];
  const inspect = (route: SavedRoute) => { setEditing(route); setOpen(false); };
  const label = (route: SavedRoute) => `${typeof route.name === 'string' ? `${route.name} / ` : ''}${route.id}`;
  const evidence = (row: MatchResult) => <Space orientation="vertical" size={4}>
    <Tag color={row.status === 'Candidate' ? 'blue' : row.status === 'Needs runtime check' ? 'orange' : 'default'}>{row.status}</Tag>
    {row.reasons.map((reason) => <Typography.Text key={reason} style={{ overflowWrap: 'anywhere' }}>{reason}</Typography.Text>)}
    {Object.keys(row.parameters).length > 0 && <Typography.Text code style={{ overflowWrap: 'anywhere' }}>Parameters: {JSON.stringify(row.parameters)}</Typography.Text>}
  </Space>;
  return <>
    <Button onClick={() => setOpen(true)}>Preview request matching</Button>
    <Modal title="Request matching preview" open={open} onCancel={close} width={1100} destroyOnHidden style={{ top: 24 }}
      styles={{ container: { maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column' }, header: { flexShrink: 0 }, body: { minHeight: 0, overflowY: 'auto' }, footer: { flexShrink: 0 } }} footer={<Button onClick={close}>Close request preview</Button>}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Paragraph style={{ margin: 0 }}>Find saved Route candidates for a method, host and normalized path. Choose the actual gateway router mode. This preview reads configuration and sends no traffic request.</Typography.Paragraph>
        <form onSubmit={(event) => { event.preventDefault(); void preview(); }}>
          <div style={{ display: 'grid', gridTemplateColumns: screens.md ? '140px 1fr 1fr' : '1fr', gap: 12 }}>
            <div><label htmlFor="request-preview-method">HTTP method</label><Input id="request-preview-method" value={input.method} disabled={loading} onChange={(event) => change({ method: event.target.value.toUpperCase() })} /></div>
            <div><label htmlFor="request-preview-host">Host name</label><Input id="request-preview-host" value={input.host} disabled={loading} placeholder="api.example.com" onChange={(event) => change({ host: event.target.value })} /></div>
            <div><label htmlFor="request-preview-path">Normalized URI path</label><Input id="request-preview-path" value={input.path} disabled={loading} placeholder="/api/users" onChange={(event) => change({ path: event.target.value })} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label htmlFor="request-preview-router">Configured HTTP router</label><Select id="request-preview-router" aria-label="Configured HTTP router" value={input.router || undefined} disabled={loading} placeholder="Choose router mode" style={{ width: '100%' }}
              options={HTTP_ROUTERS.map((router) => ({ value: router, label: router }))} onChange={(router) => change({ router })} /></div>
          </div>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>Use the path after Nginx normalization, without query string or percent escapes. The selected mode is your input; it is not detected from the gateway.</Typography.Paragraph>
          <Button type="primary" htmlType="submit" aria-label="Preview candidates" aria-busy={loading} loading={loading}>Preview candidates</Button>
        </form>
        {error && <Alert type="error" showIcon title="Preview unavailable" description={error} />}
        <Collapse size="small" items={[{ key: 'scope', label: 'Supported conditions and uncertainty', children: <Typography.Paragraph style={{ margin: 0 }}>
          Supports literal and trailing-prefix URIs, exact and leading-wildcard hosts and method sets. Parameter mode also supports complete :name segments and a final *name segment.
          Disabled Routes are excluded. Address rules, vars, custom filter functions and unsupported patterns need runtime checks.
          Results are candidates, not a selected winner: priority, specificity and router ordering can still choose among candidates.
          Plugins, rewrites, authentication, upstream health and Nginx URI normalization are outside this preview. Reads are not an atomic snapshot.
        </Typography.Paragraph> }]} />
        {result && <>
          <Typography.Text role="status">{result.rows.filter((row) => row.status === 'Candidate').length} candidate(s) / {result.rows.filter((row) => row.status === 'Needs runtime check').length} runtime check(s) / {result.rows.filter((row) => row.status === 'Excluded' || row.status === 'Disabled').length} excluded / Read {result.rows.length} Routes at {result.at}</Typography.Text>
          <Checkbox checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)}>Show excluded and disabled Routes</Checkbox>
          {rows.length === 0 && result.rows.length > 0 && <Alert type="info" title="No candidates in the supported conditions" description="Show excluded Routes to inspect reasons. Live routing is not verified by this result." />}
          <Table<MatchResult> size="small" rowKey={(row) => String(row.route.id)} dataSource={rows} pagination={{ pageSize: 6, showSizeChanger: false }}
            locale={{ emptyText: <Typography.Text>{result.rows.length ? 'No candidates for these request inputs.' : 'No saved HTTP Routes to preview.'}</Typography.Text> }} columns={!screens.md ? [
            { title: 'Route / matching evidence', key: 'all', render: (_, row) => <Space orientation="vertical"><Typography.Text strong style={{ overflowWrap: 'anywhere' }}>{label(row.route)}</Typography.Text>{evidence(row)}<Button onClick={() => inspect(row.route)}>Open RAW</Button></Space> },
          ] : [
            { title: 'Route', key: 'route', width: '24%', render: (_, row) => <Space orientation="vertical"><Typography.Text strong style={{ overflowWrap: 'anywhere' }}>{label(row.route)}</Typography.Text><Typography.Text type="secondary">Priority: {typeof row.route.priority === 'number' ? row.route.priority : 0}</Typography.Text></Space> },
            { title: 'Matching evidence', key: 'result', render: (_, row) => evidence(row) },
            { title: 'Inspect', key: 'inspect', width: 110, render: (_, row) => <Button onClick={() => inspect(row.route)}>Open RAW</Button> },
          ]} />
        </>}
      </Space>
    </Modal>
    {editing && <RawDrawer open api={`/routes/${encodeURIComponent(String(editing.id))}`} title={`Route: ${label(editing)}`} initialData={editing}
      onSaved={() => { setResult(undefined); }} onClose={() => { setEditing(undefined); setOpen(true); setResult(undefined); }} />}
  </>;
};
