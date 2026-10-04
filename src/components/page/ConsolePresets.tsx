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
import { AutoComplete, Button, Drawer, Empty, Input, Modal, Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';

import { presetCollection, presetIdentity, type RequestPreset } from '@/utils/consoleTemplates';

type Props = { open: boolean; presets: RequestPreset[]; onClose: () => void; onRestore: (preset: RequestPreset) => void; onChange: (presets: RequestPreset[]) => boolean };
export const ConsolePresets = ({ open, presets, onClose, onRestore, onChange }: Props) => {
  const [filter, setFilter] = useState<string | undefined>(); const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<RequestPreset>(); const [name, setName] = useState(''); const [collection, setCollection] = useState(''); const [error, setError] = useState('');
  const collections = [...new Set(presets.map((item) => item.collection))].sort((a, b) => a.localeCompare(b));
  const shown = presets.filter((item) => (filter === undefined || item.collection === filter) && `${item.name} ${item.endpoint}`.toLowerCase().includes(search.trim().toLowerCase()));
  const rename = () => {
    if (!editing || !name.trim()) { setError('Enter a preset name.'); return; }
    const entered = presetCollection(collection);
    const nextCollection = collections.find((item) => item.toLowerCase() === entered.toLowerCase()) ?? entered;
    const conflict = presets.find((item) => item.id !== editing.id && presetIdentity(item.name, item.collection) === presetIdentity(name, nextCollection));
    if (conflict) { setError('That collection already contains a preset with this name. Choose a different name.'); return; }
    if (onChange(presets.map((item) => item.id === editing.id ? { ...item, name: name.trim(), collection: nextCollection } : item))) { setEditing(undefined); setFilter(undefined); }
  };
  return <>
    <Drawer title="Session presets" open={open} onClose={onClose} styles={{ wrapper: { width: 'min(520px, 100vw)' } }}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text type="secondary">Presets are stored only in this browser tab and are removed when the session ends. Up to 20 requests; collections organize this list.</Typography.Text>
        <Select aria-label="Filter preset collection" virtual={false} value={filter === undefined ? 'all' : `collection:${filter}`} style={{ width: '100%' }} onChange={(value) => setFilter(value === 'all' ? undefined : value.slice('collection:'.length))}
          options={[{ value: 'all', label: 'All collections' }, ...collections.map((value) => ({ value: `collection:${value}`, label: value || 'Unfiled' }))]} />
        <Input aria-label="Search session presets" allowClear placeholder="Search name or path" value={search} onChange={(event) => setSearch(event.target.value)} />
        {shown.map((preset) => <div key={preset.id} style={{ border: '1px solid var(--ant-color-border-secondary)', borderRadius: 8, padding: 12 }}>
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>{preset.name}</Typography.Text>
            <Space wrap><Tag>{preset.collection || 'Unfiled'}</Tag><Tag>{preset.method}</Tag></Space>
            <Typography.Text code style={{ overflowWrap: 'anywhere' }}>{preset.endpoint}</Typography.Text>
            <Space wrap><Button onClick={() => onRestore(preset)} aria-label={`Load preset ${preset.name}`}>Load request</Button>
              <Button aria-label={`Edit preset details ${preset.name}`} onClick={() => { setEditing(preset); setName(preset.name); setCollection(preset.collection); setError(''); }}>Organize</Button>
              <Button danger aria-label={`Delete preset ${preset.name}`} onClick={() => onChange(presets.filter((item) => item.id !== preset.id))}>Delete</Button></Space>
          </Space>
        </div>)}
        {!shown.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={presets.length ? 'No presets match these filters.' : 'Save the current request to create a session preset.'} />}
      </Space>
    </Drawer>
    <Modal title="Organize session preset" open={!!editing} onCancel={() => setEditing(undefined)} onOk={rename} okText="Save preset details" okButtonProps={{ disabled: !name.trim() }}>
      <Space orientation="vertical" style={{ width: '100%' }}>
        <label htmlFor="organize-preset-name">Preset name</label><Input id="organize-preset-name" value={name} maxLength={128} onChange={(event) => { setName(event.target.value); setError(''); }} />
        <label htmlFor="organize-preset-collection">Collection</label><AutoComplete placement="topLeft" filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())} id="organize-preset-collection" aria-label="Collection" value={collection} options={collections.filter(Boolean).map((value) => ({ value }))} style={{ width: '100%' }} onChange={(value) => { setCollection(value); setError(''); }} placeholder="Unfiled" maxLength={64} />
        {error && <Typography.Text role="alert" type="danger">{error}</Typography.Text>}
      </Space>
    </Modal>
  </>;
};
