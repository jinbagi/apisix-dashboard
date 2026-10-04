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
import { DiffEditor } from '@monaco-editor/react';
import { Button, Modal, Radio, Space, Tabs, Typography } from 'antd';
import { useState } from 'react';

import { APP_CODE_EDITOR_FONT_SIZE, APP_MONOSPACE_FONT_FAMILY } from '@/config/typography';
import { useThemeMode } from '@/stores/global';
import { type ConflictChoice, rawConflicts, type RawConflictSnapshot, resolveRawConflicts } from '@/utils/rawConflict';

import classes from './RawConflictResolver.module.css';

type Props = { snapshot: RawConflictSnapshot; onCancel: () => void; onDiscard: () => void;
  onResolve: (draft: Record<string, unknown>) => void };
const json = (value: unknown) => value === undefined ? '(Absent)' : JSON.stringify(value, null, 2);
export const RawConflictResolver = ({ snapshot, onCancel, onDiscard, onResolve }: Props) => {
  const { mode } = useThemeMode();
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const entries = rawConflicts(snapshot);
  const remaining = entries.filter(({ pointer }) => !choices[pointer]).length;
  return <Modal open title="Resolve concurrent changes" width={1120} style={{ top: 24, paddingBottom: 24 }}
    styles={{ body: { maxHeight: 'calc(100dvh - 280px)', overflowY: 'auto' } }} onCancel={onCancel} destroyOnHidden
    footer={<Space wrap>
      <Button onClick={onCancel}>Keep editing</Button>
      <Button onClick={onDiscard}>Use latest and discard draft</Button>
      <Button type="primary" disabled={remaining > 0} onClick={() => onResolve(resolveRawConflicts(snapshot, choices))}>
        Apply choices to draft
      </Button>
    </Space>}>
    <p>Nothing was saved. These fields changed in APISIX while you were editing: {entries.map(({ path }) => path.join('.')).join(', ')}.</p>
    <p>Choose each conflicting value. Unrelated server changes and your other edits are preserved. Review the resulting draft, then save.</p>
    <Tabs items={[
      { key: 'fields', label: 'Conflicting fields', children: <>
        <Space wrap className={classes.summary}>
          <Typography.Text role="status">{remaining} of {entries.length} choices remaining</Typography.Text>
          <Button size="small" onClick={() => setChoices(Object.fromEntries(entries.map(({ pointer }) => [pointer, 'mine'])))}>Choose all mine</Button>
          <Button size="small" onClick={() => setChoices(Object.fromEntries(entries.map(({ pointer }) => [pointer, 'server'])))}>Choose all server</Button>
        </Space>
        <div className={classes.list}>{entries.map((entry) => <section key={entry.pointer} className={classes.field} aria-label={`Conflict ${entry.pointer}`}>
          <Typography.Text code className={classes.pointer}>{entry.pointer}</Typography.Text>
          <div className={classes.values}>
            <div><strong>Original</strong><pre>{json(entry.before)}</pre></div>
            <div><strong>Latest server</strong><pre>{json(entry.latest)}</pre></div>
            <div><strong>My draft</strong><pre>{entry.draft == null ? '(Remove field)' : json(entry.draft)}</pre></div>
          </div>
          <Radio.Group aria-label={`Keep value for ${entry.pointer}`} value={choices[entry.pointer]}
            onChange={(event) => setChoices((current) => ({ ...current, [entry.pointer]: event.target.value }))}>
            <Radio value="mine">Keep my value</Radio><Radio value="server">Keep server value</Radio>
          </Radio.Group>
        </section>)}</div>
      </> },
      { key: 'json', label: 'Compare JSON', children: <>
        <p>Latest server (left) / Your draft (right)</p>
        <DiffEditor height="min(48vh, 440px)" language="json" theme={mode === 'dark' ? 'vs-dark' : 'vs-light'}
          original={JSON.stringify(snapshot.latest, null, 2)} modified={JSON.stringify(snapshot.draft, null, 2)}
          options={{ readOnly: true, originalEditable: false, minimap: { enabled: false }, renderSideBySide: true,
            useInlineViewWhenSpaceIsLimited: true, automaticLayout: true, wordWrap: 'on',
            fontFamily: APP_MONOSPACE_FONT_FAMILY, fontSize: APP_CODE_EDITOR_FONT_SIZE }} />
      </> },
    ]} />
  </Modal>;
};
