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
import { Link } from '@tanstack/react-router';
import { Button, Input, Modal, Table, Typography } from 'antd';
import { useMemo, useState } from 'react';

/** Keep large Global Rule impact lists from expanding a diagnostics row. */
export function AffectedRoutes({ routes, source }: { routes: string[]; source: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const match = query.trim().toLowerCase();
    if (!match) return routes;
    return routes.filter((route) => route.toLowerCase().includes(match));
  }, [routes, query]);
  if (routes.length <= 3) return <Typography.Text style={{ overflowWrap: 'anywhere' }}>{routes.join(', ') || (/^\/consumer(?:s|_groups)\//.test(source) ? 'Depends on the authenticated Consumer' : 'No Route references observed')}</Typography.Text>;
  return <>
    <div style={{ maxWidth: 280, overflowWrap: 'anywhere' }}>
      <Typography.Text>{routes.length} potentially affected routes</Typography.Text>
      <div><Typography.Text type="secondary">{routes.slice(0, 3).join(', ')}…</Typography.Text></div>
      <Button size="small" onClick={() => { setQuery(''); setPage(1); setOpen(true); }}>View affected routes</Button>
    </div>
    <Modal title="Potentially affected routes" open={open} onCancel={() => setOpen(false)} width={720} destroyOnHidden
      footer={<Button onClick={() => setOpen(false)}>Close affected routes</Button>}>
      <Typography.Paragraph code style={{ overflowWrap: 'anywhere' }}>{source}</Typography.Paragraph>
      <Typography.Paragraph>Saved reference matches. Overrides, disabled plugins and request conditions may reduce actual impact.</Typography.Paragraph>
      <Input.Search aria-label="Filter affected routes" placeholder="Filter by route ID or type" value={query} allowClear
        onChange={(event) => { setQuery(event.target.value); setPage(1); }} style={{ marginBottom: 12 }} />
      <Table size="small" rowKey="path" dataSource={open ? filtered.map((path) => ({ path })) : []} scroll={{ y: 360 }}
        locale={{ emptyText: <Typography.Text type="secondary">No affected Routes match this filter.</Typography.Text> }}
        pagination={{ current: page, pageSize: 10, showSizeChanger: false, onChange: setPage, showTotal: (total) => `${total} of ${routes.length} routes` }}
        columns={[{ title: 'Route', dataIndex: 'path', render: (path: string) => <Link target="_blank" rel="noopener noreferrer"
          style={{ overflowWrap: 'anywhere' }} to={path.startsWith('/stream_routes/') ? '/stream_routes/detail/$id' : '/routes/detail/$id'}
          params={{ id: decodeURIComponent(path.split('/')[2]) }}>{path}</Link> }]} />
    </Modal>
  </>;
}