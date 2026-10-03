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
import { Button, message, Select, Space, Tooltip, Typography } from 'antd';
import { getLocation, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser';
import type { editor } from 'monaco-editor';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ZodTypeAny } from 'zod';

import { restorePatchReadonlyFields } from '@/utils/apisixEditable';
import { changedJsonPaths, jsonPathOffset, toJsonPointer } from '@/utils/jsonNavigation';
import { monaco } from '@/utils/monaco';

const { KeyCode, KeyMod } = monaco;

export const RawJsonNavigation = ({ codeEditor, value, original, schema, resourceBase, disabled }: {
  codeEditor: editor.IStandaloneCodeEditor | null; value: string; original: string;
  schema?: ZodTypeAny | null; resourceBase: Record<string, unknown>; disabled: boolean;
}) => {
  const [pointer, setPointer] = useState('');
  const [selected, setSelected] = useState<string>();
  const [problemIndex, setProblemIndex] = useState(-1);
  const [problemMessage, setProblemMessage] = useState('');
  const changes = useMemo(() => changedJsonPaths(original, value), [original, value]);
  const problems = useMemo(() => {
    const errors: ParseError[] = [];
    parseTree(value, errors, { disallowComments: true, allowTrailingComma: false });
    if (errors.length) return errors.map((error) => ({ offset: error.offset, message: printParseErrorCode(error.error) }));
    try {
      const parsed = JSON.parse(value);
      const validation = schema?.safeParse(restorePatchReadonlyFields(parsed, resourceBase));
      return validation && !validation.success ? validation.error.issues.map((issue) => ({
        offset: jsonPathOffset(value, issue.path), message: `${toJsonPointer(issue.path) || '/'}: ${issue.message}`,
      })) : [];
    } catch { return []; }
  }, [value, schema, resourceBase]);
  const jump = useCallback((offset: number) => {
    const model = codeEditor?.getModel();
    if (!model || disabled) return;
    const position = model.getPositionAt(offset);
    codeEditor?.setPosition(position); codeEditor?.revealPositionInCenter(position); codeEditor?.focus();
  }, [codeEditor, disabled]);
  const choose = useCallback((path: string) => {
    const match = changes.find((entry) => toJsonPointer(entry) === path);
    if (!match) return;
    setSelected(path); jump(jsonPathOffset(value, match));
  }, [changes, jump, value]);
  const navigate = useCallback((direction: number) => {
    if (!changes.length) return;
    const current = changes.findIndex((entry) => toJsonPointer(entry) === selected);
    const next = ((current < 0 ? direction > 0 ? -1 : 0 : current) + direction + changes.length) % changes.length;
    choose(toJsonPointer(changes[next]));
  }, [changes, choose, selected]);
  const nextProblem = useCallback(() => {
    if (!problems.length) return;
    const next = (problemIndex + 1) % problems.length;
    setProblemIndex(next); setProblemMessage(problems[next].message); jump(problems[next].offset);
  }, [jump, problemIndex, problems]);
  const copyPointer = useCallback(async () => {
    try { await navigator.clipboard.writeText(pointer); message.success('JSON Pointer copied'); }
    catch { message.error('Could not copy JSON Pointer'); }
  }, [pointer]);
  useEffect(() => {
    if (!codeEditor) return;
    const sync = () => {
      const model = codeEditor.getModel(); const position = codeEditor.getPosition();
      if (model && position) setPointer(toJsonPointer(getLocation(model.getValue(), model.getOffsetAt(position)).path));
    };
    sync(); const subscription = codeEditor.onDidChangeCursorPosition(sync);
    return () => subscription.dispose();
  }, [codeEditor, value]);
  useEffect(() => {
    if (!codeEditor || disabled) return;
    const actions = [
      codeEditor.addAction({ id: 'raw.nextChange', label: 'Next changed JSON field', keybindings: [KeyMod.Alt | KeyCode.BracketRight], run: () => navigate(1) }),
      codeEditor.addAction({ id: 'raw.previousChange', label: 'Previous changed JSON field', keybindings: [KeyMod.Alt | KeyCode.BracketLeft], run: () => navigate(-1) }),
      codeEditor.addAction({ id: 'raw.nextProblem', label: 'Next JSON or schema problem', keybindings: [KeyCode.F8], run: nextProblem }),
      codeEditor.addAction({ id: 'raw.copyPointer', label: 'Copy JSON Pointer', keybindings: [KeyMod.Alt | KeyMod.Shift | KeyCode.KeyC], run: copyPointer }),
    ];
    return () => actions.forEach((action) => action.dispose());
  }, [codeEditor, copyPointer, disabled, navigate, nextProblem]);
  return <Space direction="vertical" size={4} style={{ marginBottom: 8, flexShrink: 0 }}>
    <Space wrap size="small">
      <Select aria-label="Changed JSON field" placeholder={`Changed fields (${changes.length})`} showSearch optionFilterProp="label"
        style={{ width: 240, maxWidth: '100%' }} disabled={disabled || !changes.length}
        value={changes.some((path) => toJsonPointer(path) === selected) ? selected : undefined}
        options={changes.map((path) => ({ value: toJsonPointer(path), label: toJsonPointer(path) || '(root)' }))} onChange={choose} />
      <Tooltip title="Alt+[ / Alt+] jumps between changed fields. Removed fields jump to their parent.">
        <Space.Compact><Button disabled={disabled || !changes.length} onClick={() => navigate(-1)}>Previous field</Button>
          <Button disabled={disabled || !changes.length} onClick={() => navigate(1)}>Next field</Button></Space.Compact>
      </Tooltip>
      <Tooltip title="F8 jumps to the next JSON or schema problem. Missing properties jump to their parent.">
        <Button disabled={disabled || !problems.length} onClick={nextProblem}>Next problem ({problems.length})</Button>
      </Tooltip>
      <Tooltip title={`Alt+Shift+C / RFC 6901 pointer: ${pointer || '(root: empty string)'}`}>
        <Button disabled={!codeEditor || disabled} onClick={() => void copyPointer()}>Copy JSON path</Button>
      </Tooltip>
    </Space>
    {problemMessage && problems.length > 0 && <Typography.Text type="danger" role="status">{problemMessage}</Typography.Text>}
  </Space>;
};
