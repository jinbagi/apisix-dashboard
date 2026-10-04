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
import { Alert, Button, Collapse, Grid, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';

import { readRoutesForOverlap } from '@/apis/route-overlap';
import { RawDrawer } from '@/components/page/RawDrawer';
import { type RouteOverlap, routeOverlapReport, type SavedRoute } from '@/utils/routeOverlap';

export const RouteOverlapDiagnostics = () => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState('');
  const [editing, setEditing] = useState<SavedRoute>();
  const request = useRef<AbortController | undefined>(undefined);
  const screens = Grid.useBreakpoint();
  useEffect(() => () => request.current?.abort(), []);
  const refresh = async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(''); setRoutes([]); setCheckedAt('');
    try {
      const next = await readRoutesForOverlap(controller.signal); if (controller.signal.aborted) return;
      setRoutes(next); setSelected((current) => next.some((route) => String(route.id) === current) ? current : next[0] && String(next[0].id));
      setCheckedAt(new Date().toLocaleTimeString());
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to compare Routes.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const close = () => { request.current?.abort(); setLoading(false); setOpen(false); };
  const selectedRoute = routes.find((route) => String(route.id) === selected);
  const report = useMemo(() => selectedRoute ? routeOverlapReport(selectedRoute, routes) : undefined, [routes, selectedRoute]);
  const inspect = (route: SavedRoute) => { setEditing(route); setOpen(false); };
  const routeName = (route: SavedRoute) => `${typeof route.name === 'string' ? route.name + ' / ' : ''}${route.id}`;
  const comparison = (row: RouteOverlap) => <Space orientation="vertical" size={4}>
    <Tag color={row.status === 'Needs runtime check' ? 'default' : 'orange'}>{row.status}</Tag>
    {row.reasons.map((reason) => <Typography.Text key={reason} style={{ overflowWrap: 'anywhere' }}>{reason}</Typography.Text>)}
  </Space>;
  return <>
    <Button onClick={() => { setOpen(true); void refresh(); }}>Check route overlaps</Button>
    <Modal title="Route overlap candidates" open={open} onCancel={close} width={1050} destroyOnHidden style={{ top: 24 }}
      styles={{ body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' } }} footer={<Button onClick={close}>Close route comparison</Button>}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Paragraph style={{ margin: 0 }}>Compare one saved Route with all HTTP Routes, including those outside the current table filters. Reads saved configuration only; no traffic tests or configuration writes are sent.</Typography.Paragraph>
        <Collapse size="small" items={[{ key: 'scope', label: 'Comparison scope and limitations', children: <Typography.Paragraph style={{ margin: 0 }}>
          Checks literal and trailing-wildcard URIs, exact and leading-wildcard hosts, HTTP methods and priority.
          Disabled Routes are excluded. Parameters, normalization-sensitive URIs, address conditions, vars and filter_func remain explicit runtime checks.
          A shadow candidate needs identical supported match sets and different priorities; partial overlap never implies complete shadowing.
          Router mode, Nginx normalization and runtime behavior are not simulated. Reads are not an atomic snapshot.
          {' '}<a href="https://apisix.apache.org/docs/apisix/router-radixtree/" target="_blank" rel="noopener noreferrer">APISIX routing rules</a>
        </Typography.Paragraph> }]} />
        <Space wrap><Button onClick={() => void refresh()} loading={loading}>Refresh route comparison</Button>{checkedAt && <Typography.Text type="secondary">Read {routes.length} Routes at {checkedAt}</Typography.Text>}</Space>
        {loading && <Spin aria-label="Loading Routes for comparison" />}
        {error && <Alert type="error" showIcon title="Route comparison unavailable" description={error} />}
        {!loading && !error && checkedAt && (routes.length === 0 ? <Alert type="info" title="No saved HTTP Routes to compare" /> : <>
          <label htmlFor="overlap-selected-route">Route to compare</label>
          <Select id="overlap-selected-route" aria-label="Route to compare" showSearch optionFilterProp="label" value={selected} onChange={setSelected} style={{ width: '100%' }}
            options={routes.map((route) => ({ value: String(route.id), label: routeName(route) }))} />
          {selectedRoute && <Button onClick={() => inspect(selectedRoute)}>Open selected Route RAW</Button>}
          {selectedRoute?.status === 0 ? <Alert type="info" title="Selected Route is disabled" description="Disabled Routes do not participate in this comparison." /> : report && <>
            <Typography.Text role="status">{report.candidates.length} candidate(s) / {report.compared} other enabled Route(s) compared / {report.disabled} disabled Route(s) excluded</Typography.Text>
            {report.candidates.length === 0 && <Alert type="info" title="No overlaps found in the checked scope" description="This does not verify live routing or conditions outside the comparison scope." />}
            <Table<RouteOverlap> size="small" rowKey={(row) => String(row.route.id)} dataSource={report.candidates} pagination={{ pageSize: 8, showSizeChanger: false }}
              columns={!screens.md ? [{ title: 'Candidates', key: 'candidate', render: (_, row) => <Space orientation="vertical" style={{ width: '100%' }}>
                <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>{routeName(row.route)}</Typography.Text>{comparison(row)}
                <Button onClick={() => inspect(row.route)}>Open RAW</Button>
              </Space> }] : [
                { title: 'Candidate Route', key: 'route', width: '25%', render: (_, row) => <Typography.Text style={{ overflowWrap: 'anywhere' }}>{routeName(row.route)}</Typography.Text> },
                { title: 'Comparison', key: 'comparison', render: (_, row) => comparison(row) },
                { title: 'Inspect', key: 'inspect', width: 110, render: (_, row) => <Button onClick={() => inspect(row.route)}>Open RAW</Button> },
              ]} />
          </>}
        </>)}
      </Space>
    </Modal>
    {editing && <RawDrawer open api={`/routes/${encodeURIComponent(String(editing.id))}`} title={`Route: ${routeName(editing)}`} initialData={editing}
      onSaved={refresh} onClose={() => { setEditing(undefined); setOpen(true); void refresh(); }} />}
  </>;
};
