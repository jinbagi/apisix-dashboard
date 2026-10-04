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
import { App, Badge, Button, Drawer, Grid, Tooltip, Typography } from 'antd';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

import { AdminApiJsonEditor } from '@/components/page/AdminApiJsonEditor';
import { RawWorkspaceContext, type RawWorkspaceTab, useRawWorkspace } from '@/stores/rawWorkspace';
import IconClose from '~icons/material-symbols/close';
import IconRaw from '~icons/material-symbols/code-blocks-outline';
import IconFullscreen from '~icons/material-symbols/fullscreen';
import IconFullscreenExit from '~icons/material-symbols/fullscreen-exit';
import IconMinimize from '~icons/material-symbols/minimize';

import classes from './RawDrawer.module.css';

const WIDTH_KEY = 'raw-workspace:width';
const MIN_WIDTH = 480;
const readWidth = () => {
  try {
    const width = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(width) && width >= MIN_WIDTH && width <= 3840) return width;
  } catch { /* Browser storage is optional. */ }
  return 960;
};


function TabEditor({ tab, active, updateStatus }: {
  tab: RawWorkspaceTab;
  active: boolean;
  updateStatus: (id: string, state: Partial<Pick<RawWorkspaceTab, 'dirty' | 'saving'>>) => void;
}) {
  const dirty = useCallback((value: boolean) => updateStatus(tab.id, { dirty: value }), [tab.id, updateStatus]);
  const saving = useCallback((value: boolean) => updateStatus(tab.id, { saving: value }), [tab.id, updateStatus]);
  return <AdminApiJsonEditor api={tab.api} active={active} persistentSession autoFetch fillAvailable
    initialData={tab.initialData} onDirtyChange={dirty} onSavingChange={saving} onSaved={tab.onSaved} />;
}

export function RawWorkspaceButton() {
  const { tabs, show } = useRawWorkspace();
  if (!tabs.length) return null;
  const dirty = tabs.filter((tab) => tab.dirty).length;
  return <Tooltip title={`${tabs.length} RAW tabs${dirty ? `, ${dirty} unsaved` : ''}`}>
    <Badge dot={dirty > 0}>
      <Button size="small" onClick={show} icon={<IconRaw />} aria-label={`Open RAW workspace (${tabs.length} tabs${dirty ? `, ${dirty} unsaved` : ''})`}>{tabs.length}</Button>
    </Badge>
  </Tooltip>;
}

/** Lives above route matches: navigation cannot dispose a tab's in-memory editor. */
export function RawWorkspaceProvider({ children }: { children: ReactNode }) {
  const { modal, message } = App.useApp();
  const [tabs, setTabs] = useState<RawWorkspaceTab[]>([]);
  const [activeId, setActiveId] = useState('');
  const [open, setOpen] = useState(false);
  const [preferredWidth, setPreferredWidth] = useState(readWidth);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [fullScreen, setFullScreen] = useState(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const confirmation = useRef(false);
  const tabListRef = useRef<HTMLDivElement>(null);
  const workspaceId = useId();
  const screens = Grid.useBreakpoint();
  const isFullScreen = fullScreen || !screens.md;
  const maxWidth = Math.max(MIN_WIDTH, viewportWidth);
  const width = Math.min(preferredWidth, maxWidth);
  const resize = (next: number) => setPreferredWidth(Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, next))));
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const needsUnloadProtection = tabs.some((tab) => tab.dirty || tab.saving);
  const updateStatus = useCallback((id: string, state: Partial<Pick<RawWorkspaceTab, 'dirty' | 'saving'>>) => {
    setTabs((current) => current.map((tab) => tab.id === id && Object.entries(state).some(([key, value]) => tab[key as 'dirty' | 'saving'] !== value) ? { ...tab, ...state } : tab));
  }, []);
  const openTab = useCallback<NonNullable<React.ContextType<typeof RawWorkspaceContext>>['openTab']>((request) => {
    const id = request.api.replace(/\/+$/, '');
    if (!id) return;
    setTabs((current) => current.some((tab) => tab.id === id)
      ? current.map((tab) => tab.id === id ? { ...tab, onSaved: request.onSaved, title: request.title } : tab)
      : [...current, { ...request, api: id, id, dirty: false, saving: false }]);
    setActiveId(id);
    setOpen(true);
  }, []);
  const show = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(preferredWidth)); }
    catch { /* Browser storage is optional; resource tabs remain in memory. */ }
  }, [preferredWidth]);
  useEffect(() => {
    if (!needsUnloadProtection) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [needsUnloadProtection]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => tabListRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [activeId, open, tabs.length, preferredWidth, viewportWidth, fullScreen]);

  const removeTabs = (ids: Set<string>) => {
    const remaining = tabsRef.current.filter((tab) => !ids.has(tab.id));
    if (!remaining.length) setOpen(false);
    if (ids.has(activeId)) {
      const index = tabsRef.current.findIndex((tab) => tab.id === activeId);
      setActiveId((remaining[Math.min(index, remaining.length - 1)] ?? remaining[0])?.id ?? '');
    }
    setTabs(remaining);
    if (remaining.length && open) requestAnimationFrame(() => tabListRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus());
  };
  const closeTabs = (all = false, id = active?.id) => {
    const closing = tabsRef.current.filter((tab) => all || tab.id === id);
    if (closing.some((tab) => tab.saving)) { void message.info('Save is still in progress'); return; }
    const ids = new Set(closing.map((tab) => tab.id));
    if (!closing.some((tab) => tab.dirty)) { removeTabs(ids); return; }
    if (confirmation.current) return;
    confirmation.current = true;
    modal.confirm({
      title: all ? 'Close all RAW tabs and discard unsaved changes?' : 'Discard unsaved changes?',
      content: <><p>Your RAW edits have not been saved. Closing removes these in-memory drafts:</p><ul>{closing.filter((tab) => tab.dirty).map((tab) => <li key={tab.id}>{tab.title}</li>)}</ul></>,
      okText: 'Discard', okButtonProps: { danger: true }, cancelText: 'Keep editing',
      afterClose: () => { confirmation.current = false; },
      onOk: () => {
        if (tabsRef.current.some((tab) => ids.has(tab.id) && tab.saving)) { void message.info('Save is still in progress'); return; }
        removeTabs(ids);
      },
    });
  };

  return <RawWorkspaceContext.Provider value={{ tabs, activeId: active?.id ?? '', open, openTab, show }}>
    {children}
    {tabs.length > 0 && <Drawer open={open} onClose={() => closeTabs()} placement="right" destroyOnHidden={false}
      title={<div className={classes.title}><div>{active?.title}</div><Typography.Text type="secondary" copyable style={{ fontSize: 'var(--app-font-size-sm)', fontFamily: 'var(--app-font-monospace)' }}>{active?.api}</Typography.Text></div>}
      extra={<div className={classes.workspaceActions}>
        <Tooltip title="Keep tabs and drafts while browsing other pages"><Button onClick={() => setOpen(false)} icon={<IconMinimize />}>Minimize</Button></Tooltip>
        {screens.md && <Tooltip title={fullScreen ? 'Restore panel width' : 'Use the full workspace'}><Button icon={fullScreen ? <IconFullscreenExit /> : <IconFullscreen />} onClick={() => setFullScreen((current) => !current)}>{fullScreen ? 'Exit full screen' : 'Full screen'}</Button></Tooltip>}
      </div>}
      classNames={{ body: classes.body, header: classes.workspaceHeader }}
      styles={{ wrapper: { width: isFullScreen ? '100vw' : width, maxWidth: '100vw' }, body: { display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' } }}>
      {!isFullScreen && (
        <Tooltip title="Drag or use arrow keys to resize" placement="left">
          <div
            className={classes.resizeHandle}
            role="separator"
            tabIndex={0}
            aria-label="Resize RAW panel"
            aria-orientation="vertical"
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={maxWidth}
            aria-valuenow={width}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                resize(window.innerWidth - event.clientX);
              }
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onKeyDown={(event) => {
              const next = { ArrowLeft: width + 32, ArrowRight: width - 32, Home: MIN_WIDTH, End: maxWidth }[event.key];
              if (next === undefined) return;
              event.preventDefault();
              resize(next);
            }}
          />
        </Tooltip>
      )}

      <div className={classes.workspaceBar}>
        <div className={classes.tabList} ref={tabListRef} role="tablist" aria-label="RAW resource tabs">
          {tabs.map((tab, index) => <div className={classes.tabItem} key={tab.id}>
            <button type="button" role="tab" id={`${workspaceId}-tab-${index}`} aria-controls={`${workspaceId}-panel-${index}`} aria-selected={tab.id === active?.id} tabIndex={tab.id === active?.id ? 0 : -1}
              className={classes.tab} title={`${tab.title} — ${tab.api}`} onClick={() => setActiveId(tab.id)}
              onKeyDown={(event) => {
                const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : offset ? (index + offset + tabs.length) % tabs.length : undefined;
                if (next !== undefined) { event.preventDefault(); setActiveId(tabs[next].id); const element = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]; element?.focus(); element?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
                if (event.key === 'Delete') { event.preventDefault(); closeTabs(false, tab.id); }
              }}>
              <span>{tab.title}</span><span className={classes.tabStatus} aria-label={tab.saving ? 'Saving' : tab.dirty ? 'Unsaved changes' : undefined} aria-hidden={!tab.saving && !tab.dirty}>{tab.saving ? '…' : tab.dirty ? '●' : ''}</span>
            </button>
            <Button type="text" size="small" icon={<IconClose />} aria-label={`Close RAW tab: ${tab.title}`} onClick={() => closeTabs(false, tab.id)} disabled={tab.saving} />
          </div>)}
        </div>
        <Button size="small" onClick={() => closeTabs(true)} disabled={tabs.some((tab) => tab.saving)}>Close all</Button>
      </div>
      <p className={classes.workspaceHint}><span className={classes.fullHint}>Tabs stay in memory while browsing. Minimize to open another resource. Reloading this browser page clears tabs.</span><span className={classes.shortHint}>Minimize keeps tabs. Reload clears them.</span></p>
      {tabs.map((tab, index) => <div key={tab.id} role="tabpanel" id={`${workspaceId}-panel-${index}`} aria-labelledby={`${workspaceId}-tab-${index}`} hidden={tab.id !== active?.id} className={classes.tabPanel}>
        <TabEditor tab={tab} active={open && tab.id === active?.id} updateStatus={updateStatus} />
      </div>)}
    </Drawer>}
  </RawWorkspaceContext.Provider>;
}
