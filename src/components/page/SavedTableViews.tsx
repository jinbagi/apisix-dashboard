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
import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';

import { columnFiltersSchema } from '@/types/schema/pageSearch';
import { tablePresentationSchema } from '@/utils/tablePresentation';

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
  presentation: tablePresentationSchema.extend({ columns: z.array(z.string()).transform((keys) => [...new Set(keys)].sort()) }),
});
const savedViewSchema = z.object({
  name: z.string().trim().min(1).max(64),
  snapshot: snapshotSchema,
});
type SavedView = z.infer<typeof savedViewSchema>;
export type TableViewSnapshot = z.infer<typeof snapshotSchema>;

function readViews(key: string, strict = false): SavedView[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(entries)) throw new Error('Invalid saved views');
    const names = new Set<string>();
    return entries.flatMap((entry) => {
      const parsed = savedViewSchema.safeParse(entry);
      if (!parsed.success || names.has(parsed.data.name)) return [];
      names.add(parsed.data.name);
      return [parsed.data];
    }).slice(0, 20);
  } catch {
    if (strict) throw new Error('Saved views could not be read. Existing browser storage was preserved.');
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
  const [busy, setBusy] = useState(false);
  const openedViews = useRef<SavedView[]>([]);
  const deletingView = useRef<SavedView | undefined>(undefined);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== null && event.key !== storageKey)) return;
      try {
        const fresh = readViews(storageKey, true); setViews(fresh);
        setSelected((current) => fresh.some((view) => view.name === current) ? current : undefined);
      } catch (cause) { setError((cause as Error).message); }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey]);
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
  const mutate = async (action: (fresh: SavedView[]) => void) => {
    setBusy(true);
    try {
      const run = () => { const fresh = readViews(storageKey, true); setViews(fresh); action(fresh); };
      if (navigator.locks) await navigator.locks.request(storageKey, { ifAvailable: true }, (lock) => {
        if (!lock) throw new Error('Another tab is saving views. Try again in a moment.');
        run();
      });
      else run();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update saved views.'); }
    finally { setBusy(false); }
  };
  const save = () => {
    if (!trimmedName || busy) return;
    void mutate((fresh) => {
      const previous = openedViews.current.find((view) => view.name === trimmedName);
      const latest = fresh.find((view) => view.name === trimmedName);
      if (JSON.stringify(previous) !== JSON.stringify(latest)) {
        setError('This saved view changed in another tab. Close and reopen this dialog before replacing it.'); return;
      }
      if (!latest && fresh.length >= 20) {
        setError('You can save up to 20 views per table. Delete a view before adding another.'); return;
      }
      const next = { name: trimmedName, snapshot: snapshotSchema.parse(snapshot) };
      if (persist(latest ? fresh.map((view) => view.name === trimmedName ? next : view) : [...fresh, next])) {
        setSelected(trimmedName); setOpen(false);
      }
    });
  };
  const apply = (viewName: string) => {
    try {
      const fresh = readViews(storageKey, true); setViews(fresh);
      const view = fresh.find((entry) => entry.name === viewName);
      if (!view) { setSelected(undefined); setError('This saved view was removed in another tab.'); return; }
      setSelected(viewName); setError(''); onApply(view.snapshot);
    } catch (cause) { setError((cause as Error).message); }
  };
  const remove = () => mutate((fresh) => {
    const previous = deletingView.current;
    if (!previous) return;
    const latest = fresh.find((view) => view.name === previous.name);
    if (!latest) { setSelected(undefined); return; }
    if (JSON.stringify(previous) !== JSON.stringify(latest)) {
      setError('This saved view changed in another tab. Review it before deleting.'); return;
    }
    if (persist(fresh.filter((view) => view.name !== previous.name))) setSelected(undefined);
  });

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
        disabled={busy}
        onChange={apply}
      />
      <Button disabled={busy} onClick={() => { openedViews.current = views; setName(selected ?? ''); setError(''); setOpen(true); }}>Save view</Button>
      {chosen && (
        <>
          {modified && <Tag>Modified</Tag>}
          <Button type="link" size="small" disabled={busy} onClick={() => apply(chosen.name)}>Restore view</Button>
          <Popconfirm
            title={`Delete saved view “${chosen.name}”?`}
            description="The current table and gateway resources will stay unchanged."
            okText="Delete view"
            onOpenChange={(visible) => { if (visible) deletingView.current = chosen; }}
            onConfirm={() => { void remove(); }}
          >
            <Button type="text" size="small" disabled={busy}>Delete view</Button>
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
        okButtonProps={{ disabled: !trimmedName || busy, loading: busy }}
        destroyOnHidden
      >
        <p>Keep search, labels, sorting, column filters, column visibility, order, widths, pins, row spacing, and page size together. Views are saved in this browser for this table.</p>
        <label htmlFor={id}>View name</label>
        <Input id={id} value={name} maxLength={64} showCount onChange={(event) => setName(event.target.value)} onPressEnter={save} autoFocus />
        {replacing && <p>This will replace the saved settings for “{trimmedName}”.</p>}
        {error && <Alert type="error" showIcon title={error} style={{ marginTop: 16 }} />}
      </Modal>
    </div>
  );
}
