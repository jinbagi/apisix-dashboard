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
import { createFileRoute } from '@tanstack/react-router';
import { Alert, Button, Card, Collapse, Grid, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { supportsBulkPatch } from '@/apis/bulk-patch';
import { type PluginInventory, readPluginInventory } from '@/apis/plugin-inventory';
import { JsonChangeReview } from '@/components/form/JsonChangeReview';
import { BulkRawEdit } from '@/components/page/BulkRawEdit';
import PageHeader from '@/components/page/PageHeader';
import { RawDrawer } from '@/components/page/RawDrawer';
import { comparablePluginJson, PLUGIN_SCOPES, type PluginInstance, type PluginScope, summarizePlugins } from '@/utils/pluginInventory';

function PluginInventoryPage() {
  const [data, setData] = useState<PluginInventory>();
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [plugin, setPlugin] = useState(''); const [scope, setScope] = useState(''); const [search, setSearch] = useState('');
  const [keys, setKeys] = useState<string[]>([]); const [review, setReview] = useState<PluginInstance[]>();
  const [raw, setRaw] = useState<PluginInstance>(); const controller = useRef<AbortController | undefined>(undefined);
  const narrow = !Grid.useBreakpoint().md;
  const refresh = useCallback(async () => {
    controller.current?.abort(); const pending = new AbortController(); controller.current = pending;
    setLoading(true); setData(undefined); setKeys([]); setError(''); setReview(undefined);
    try { const next = await readPluginInventory(pending.signal); if (!pending.signal.aborted) setData(next); }
    catch (cause) { if (!pending.signal.aborted) setError(cause instanceof Error ? cause.message : 'Inventory unavailable'); }
    finally { if (!pending.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => controller.current?.abort(); }, [refresh]);
  const summaries = useMemo(() => summarizePlugins(data?.rows ?? []), [data]);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data?.rows.filter((row) => (!plugin || row.plugin === plugin) && (!scope || row.scope === scope) &&
      (!query || `${row.plugin} ${row.api} ${row.name}`.toLowerCase().includes(query))) ?? [];
  }, [data, plugin, scope, search]);
  const selected = rows.filter((row) => keys.includes(row.key));
  const canCompare = selected.length === 2 && selected[0].plugin === selected[1].plugin;
  const bulkScope = selected.length > 0 && selected.every((row) => row.scope === selected[0].scope) ? selected[0].scope : undefined;
  const bulkBase = bulkScope && supportsBulkPatch(`/${bulkScope}`) ? `/${bulkScope}` : '';
  const bulkIds = [...new Set(selected.map((row) => row.id))];
  const state = (row: PluginInstance) => <Tag color={!row.valid ? 'error' : row.disabled ? 'default' : 'blue'}>{!row.valid ? 'Invalid config' : row.disabled ? 'Disabled by _meta' : 'Configured'}</Tag>;
  const inspect = (row: PluginInstance) => <Button size="small" aria-label={`Open RAW ${row.api}`} onClick={() => setRaw(row)}>Open RAW</Button>;
  return <>
    <PageHeader title="Plugin inventory" desc="Find configured plugin instances, compare values and edit selected resources."
      extra={<Button aria-label="Refresh plugin inventory" loading={loading} onClick={() => void refresh()}>Refresh inventory</Button>} />
    <Card>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        {error && <Alert type="error" title="Inventory unavailable" description={error} />}
        {!!data?.errors.length && <Alert type="warning" title="Partial inventory — some sources could not be read" description={<><ul>{data.errors.map((issue) => <li key={issue}>{issue}</li>)}</ul>Missing entries do not establish that a plugin is unused. Refresh before bulk editing.</>} />}
        {data && <Typography.Text role="status">{summaries.length} plugin names / {data.rows.length} instances / {data.sources} source resources · Read at {data.readAt}{data.errors.length ? ' · Partial' : ''}</Typography.Text>}
        <Space wrap style={{ width: '100%' }}>
          <Select aria-label="Filter inventory plugin" virtual={false} value={plugin} onChange={(value) => { setPlugin(value); setKeys([]); }} style={{ width: narrow ? 260 : 330, maxWidth: '100%' }}
            options={[{ value: '', label: 'All plugins' }, ...summaries.map((item) => ({ value: item.plugin, label: `${item.plugin} · ${item.instances} instances · ${item.variants} variants` }))]} />
          <Select aria-label="Filter inventory scope" virtual={false} value={scope} onChange={(value) => { setScope(value); setKeys([]); }} style={{ width: 220, maxWidth: '100%' }}
            options={[{ value: '', label: 'All resource kinds' }, ...Object.entries(PLUGIN_SCOPES).map(([value, label]) => ({ value, label }))]} />
          <Input aria-label="Search plugin inventory" placeholder="Plugin, resource ID or name" allowClear value={search} onChange={(event) => { setSearch(event.target.value); setKeys([]); }} style={{ width: 260, maxWidth: '100%' }} />
        </Space>
        <Space wrap>
          <Typography.Text>{selected.length} selected / {rows.length} matching</Typography.Text>
          <Button disabled={!canCompare || loading} onClick={() => setReview([...selected])}>Compare selected plugin values</Button>
          {bulkBase && <BulkRawEdit key={bulkBase} apiBase={bulkBase} selectedIds={bulkIds} disabled={loading || !!data?.errors.length} onComplete={() => void refresh()} />}
          {selected.length > 0 && <Button onClick={() => setKeys([])}>Clear selection</Button>}
        </Space>
        <Typography.Text type="secondary">Select two instances of the same plugin to compare. Select one resource kind to edit in bulk.</Typography.Text>
        <Table<PluginInstance> size="small" rowKey="key" dataSource={rows} loading={loading} pagination={{ defaultPageSize: 10, showSizeChanger: true }}
          rowSelection={{ selectedRowKeys: keys, onChange: (value) => setKeys(value.map(String)), preserveSelectedRowKeys: false, getCheckboxProps: (row) => ({ name: row.key, 'aria-label': `Select ${row.plugin} on ${row.api}` }) }}
          locale={{ emptyText: data ? 'No configured plugin instances match these filters.' : 'Read the inventory to see configured plugins.' }}
          columns={narrow ? [{ title: 'Plugin / source', key: 'summary', render: (_, row) => <Space orientation="vertical" style={{ width: '100%' }}>
            <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>{row.plugin}</Typography.Text>{state(row)}
            <Typography.Text>{PLUGIN_SCOPES[row.scope]}</Typography.Text><Typography.Text code style={{ overflowWrap: 'anywhere' }}>{row.api}</Typography.Text>{inspect(row)}
          </Space> }] : [
            { title: 'Plugin', dataIndex: 'plugin', width: '20%', render: (name: string) => <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>{name}</Typography.Text> },
            { title: 'Resource kind', dataIndex: 'scope', width: 160, render: (value: PluginScope) => PLUGIN_SCOPES[value] },
            { title: 'Source resource', key: 'source', render: (_, row) => <Space orientation="vertical" size={0}><Typography.Text>{row.name}</Typography.Text><Typography.Text code style={{ overflowWrap: 'anywhere' }}>{row.api}</Typography.Text></Space> },
            { title: 'State', key: 'state', width: 165, render: (_, row) => state(row) },
            { title: 'Inspect', key: 'raw', width: 110, render: (_, row) => inspect(row) },
          ]} />
        <Collapse size="small" items={[{ key: 'scope', label: 'Scope and comparison help', children: <Space orientation="vertical">
          <Typography.Paragraph style={{ margin: 0 }}>Includes Routes, Stream Routes, Services, Consumers, Consumer Groups, Global Rules, Plugin Configs and Consumer Credentials. Counts describe saved configuration, including disabled instances. Inheritance, runtime activation, plugin installation and Plugin Metadata are outside this inventory. Reads are not atomic.</Typography.Paragraph>
          <Typography.Text>Bulk RAW editing uses the existing preview, conflict and verification flow. Credentials use individual RAW editing. Configuration variants ignore object key order and preserve array order. Values may contain credentials; JSON comparison displays exactly the saved configuration.</Typography.Text>
        </Space> }]} />
      </Space>
    </Card>
    <JsonChangeReview open={!!review} title={`Compare ${review?.[0].plugin ?? 'plugin'}`}
      description={`Left: ${review?.[0].api ?? ''} · Right: ${review?.[1].api ?? ''}. Saved values only; this comparison does not apply changes or resolve runtime precedence.`}
      original={JSON.stringify(comparablePluginJson(review?.[0].config ?? {}), null, 2)} modified={JSON.stringify(comparablePluginJson(review?.[1].config ?? {}), null, 2)}
      confirmText="Back to inventory" onSave={() => setReview(undefined)} onCancel={() => setReview(undefined)} />
    {raw && <RawDrawer open api={raw.api} title={`${raw.plugin} source: ${raw.name}`} initialData={raw.value}
      onClose={() => setRaw(undefined)} onSaved={() => void refresh()} />}
  </>;
}
export const Route = createFileRoute('/plugin_inventory/')({ component: PluginInventoryPage });
