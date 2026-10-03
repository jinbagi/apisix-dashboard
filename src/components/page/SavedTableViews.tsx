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
import { Alert, Button, Input, Modal, Popconfirm, Select, Tag } from 'antd';
import { useId, useState } from 'react';
import { z } from 'zod';

import { columnFiltersSchema } from '@/types/schema/pageSearch';

const snapshotSchema = z.object({
  search: z.object({
    q: z.string().optional(),
    name: z.string().optional(),
    uri: z.string().optional(),
    label: z.string().optional(),
    sort_by: z.string(),
    sort_order: z.enum(['asc', 'desc']),
    page_size: z.number().int().min(10).max(500),
    column_filters: columnFiltersSchema,
  }),
  presentation: z.object({
    columns: z.array(z.string()),
    density: z.enum(['small', 'middle', 'large']),
  }),
});
const savedViewSchema = z.object({
  name: z.string().trim().min(1).max(64),
  snapshot: snapshotSchema,
});
type SavedView = z.infer<typeof savedViewSchema>;
export type TableViewSnapshot = z.infer<typeof snapshotSchema>;

function readViews(key: string): SavedView[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(entries)) return [];
    const names = new Set<string>();
    return entries.flatMap((entry) => {
      const parsed = savedViewSchema.safeParse(entry);
      if (!parsed.success || names.has(parsed.data.name)) return [];
      names.add(parsed.data.name);
      return [parsed.data];
    }).slice(0, 20);
  } catch {
    return [];
  }
}

export function SavedTableViews({
  storageKey,
  snapshot,
  onApply,
}: {
  storageKey: string;
  snapshot: TableViewSnapshot;
  onApply: (snapshot: TableViewSnapshot) => void;
}) {
  const [views, setViews] = useState(() => readViews(storageKey));
  const [selected, setSelected] = useState<string>();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const id = useId();
  const chosen = views.find((view) => view.name === selected);
  const trimmedName = name.trim();
  const replacing = views.some((view) => view.name === trimmedName);
  const modified = chosen && JSON.stringify(chosen.snapshot) !== JSON.stringify(snapshotSchema.parse(snapshot));

  const persist = (next: SavedView[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setViews(next);
      setError('');
      return true;
    } catch {
      setError('Browser storage is unavailable. Your view could not be saved.');
      return false;
    }
  };
  const save = () => {
    if (!trimmedName) return;
    if (!replacing && views.length >= 20) {
      setError('You can save up to 20 views per table. Delete a view before adding another.');
      return;
    }
    const next = { name: trimmedName, snapshot: snapshotSchema.parse(snapshot) };
    if (persist(replacing ? views.map((view) => view.name === trimmedName ? next : view) : [...views, next])) {
      setSelected(trimmedName);
      setOpen(false);
    }
  };

  return (
    <div className="resource-table-saved-views" role="region" aria-label="Saved table views">
      <Select
        virtual={false}
        aria-label="Saved views"
        placeholder="Saved views"
        className="resource-table-saved-select"
        value={selected}
        showSearch
        optionFilterProp="label"
        options={views.map((view) => ({ label: view.name, value: view.name }))}
        notFoundContent="No saved views yet"
        onChange={(value) => {
          const view = views.find((entry) => entry.name === value);
          if (view) {
            setSelected(value);
            onApply(view.snapshot);
          }
        }}
      />
      <Button onClick={() => { setName(selected ?? ''); setError(''); setOpen(true); }}>Save view</Button>
      {chosen && (
        <>
          {modified && <Tag>Modified</Tag>}
          <Button type="link" size="small" onClick={() => onApply(chosen.snapshot)}>Restore view</Button>
          <Popconfirm
            title={`Delete saved view “${chosen.name}”?`}
            description="The current table and gateway resources will stay unchanged."
            okText="Delete view"
            onConfirm={() => {
              if (persist(views.filter((view) => view.name !== chosen.name))) setSelected(undefined);
            }}
          >
            <Button type="text" size="small">Delete view</Button>
          </Popconfirm>
        </>
      )}
      {error && !open && <Alert type="error" showIcon title={error} />}
      <Modal
        title="Save table view"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={save}
        okText={replacing ? 'Update view' : 'Save view'}
        okButtonProps={{ disabled: !trimmedName }}
        destroyOnHidden
      >
        <p>Keep search, labels, sorting, column filters, visible columns, row spacing, and page size together. Views are saved in this browser for this table.</p>
        <label htmlFor={id}>View name</label>
        <Input id={id} value={name} maxLength={64} showCount onChange={(event) => setName(event.target.value)} onPressEnter={save} autoFocus />
        {replacing && <p>This will replace the saved settings for “{trimmedName}”.</p>}
        {error && <Alert type="error" showIcon title={error} style={{ marginTop: 16 }} />}
      </Modal>
    </div>
  );
}
