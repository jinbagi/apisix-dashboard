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
import { Button, Drawer, Grid, message, Modal, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';

import { AdminApiJsonEditor } from '@/components/page/AdminApiJsonEditor';
import IconFullscreen from '~icons/material-symbols/fullscreen';
import IconFullscreenExit from '~icons/material-symbols/fullscreen-exit';

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

type RawDrawerProps = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
  /** Full API path, e.g. '/routes/123' */
  api: string;
  title: string;
  /** Pre-loaded data from list cache — avoids re-fetching */
  initialData?: Record<string, unknown>;
};

export const RawDrawer = ({ open, onClose, onSaved, api, title, initialData }: RawDrawerProps) => {
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [preferredWidth, setPreferredWidth] = useState(readWidth);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [fullScreen, setFullScreen] = useState(false);
  const screens = Grid.useBreakpoint();
  const isFullScreen = fullScreen || !screens.md;
  const maxWidth = Math.max(MIN_WIDTH, viewportWidth);
  const width = Math.min(preferredWidth, maxWidth);
  const resize = (next: number) => setPreferredWidth(Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, next))));

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(preferredWidth)); }
    catch { /* Browser storage is optional. */ }
  }, [preferredWidth]);

  useEffect(() => {
    if (!open || (!isDirty && !saving)) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [isDirty, open, saving]);

  const closeDrawer = useCallback(() => {
    if (saving) {
      message.info('Save is still in progress');
      return;
    }

    if (!isDirty) {
      onClose();
      return;
    }

    Modal.confirm({
      title: 'Discard unsaved changes?',
      content: 'Your RAW edits have not been saved.',
      okText: 'Discard',
      okButtonProps: { danger: true },
      cancelText: 'Keep editing',
      onOk: onClose,
    });
  }, [isDirty, onClose, saving]);

  return (
    <Drawer
      open={open}
      onClose={closeDrawer}
      title={
        <div className={classes.title}>
          <div>{title}</div>
          <Typography.Text type="secondary" copyable style={{ fontSize: 'var(--app-font-size-sm)', fontFamily: 'var(--app-font-monospace)' }}>
            {api}
          </Typography.Text>
        </div>
      }
      extra={screens.md && (
        <Tooltip title={fullScreen ? 'Restore panel width' : 'Use the full workspace'}>
          <Button
            icon={fullScreen ? <IconFullscreenExit /> : <IconFullscreen />}
            onClick={() => setFullScreen((current) => !current)}
          >
            {fullScreen ? 'Exit full screen' : 'Full screen'}
          </Button>
        </Tooltip>
      )}
      classNames={{ body: classes.body }}
      styles={{
        wrapper: { width: isFullScreen ? '100vw' : width, maxWidth: '100vw' },
        body: {
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        },
      }}
      placement="right"
      destroyOnHidden
    >
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
      <AdminApiJsonEditor
        active={open}
        api={api}
        autoFetch
        fillAvailable
        initialData={initialData}
        onDirtyChange={setIsDirty}
        onSaved={onSaved}
        onSavingChange={setSaving}
      />
    </Drawer>
  );
};
