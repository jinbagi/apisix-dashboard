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
import { Editor, type EditorProps } from '@monaco-editor/react';
import { clsx } from 'clsx';

import {
  APP_CODE_EDITOR_FONT_SIZE,
  APP_MONOSPACE_FONT_FAMILY,
} from '@/config/typography';
import { useThemeMode } from '@/stores/global';

import classes from './JsonCodeEditor.module.css';

const jsonEditorOptions: NonNullable<EditorProps['options']> = {
  minimap: { enabled: false },
  automaticLayout: true,
  wordWrap: 'on',
  wrappingIndent: 'indent',
  lineNumbers: 'on',
  lineNumbersMinChars: 3,
  lineDecorationsWidth: 0,
  renderLineHighlight: 'none',
  scrollBeyondLastLine: false,
  tabSize: 2,
  insertSpaces: true,
  detectIndentation: false,
  formatOnPaste: true,
  padding: { top: 12, bottom: 12 },
  fontFamily: APP_MONOSPACE_FONT_FAMILY,
  fontSize: APP_CODE_EDITOR_FONT_SIZE,
};

type JsonCodeEditorProps = Pick<
  EditorProps,
  'height' | 'onChange' | 'onMount' | 'onValidate' | 'value' | 'path' | 'keepCurrentModel' | 'saveViewState'
> & {
  readOnly?: boolean;
  hasError?: boolean;
  variant?: 'contained' | 'flush';
  options?: EditorProps['options'];
};

export const JsonCodeEditor = ({
  height,
  value,
  onChange,
  onMount,
  onValidate,
  path,
  keepCurrentModel,
  saveViewState,
  readOnly = false,
  hasError = false,
  variant = 'contained',
  options,
}: JsonCodeEditorProps) => {
  const { mode } = useThemeMode();

  return (
    <div
      className={clsx(
        variant === 'contained' ? classes.contained : classes.flush,
        hasError && classes.error
      )}
      style={{ height }}
    >
      <Editor
        height="100%"
        language="json"
        theme={mode === 'dark' ? 'vs-dark' : 'vs-light'}
        value={value}
        path={path}
        keepCurrentModel={keepCurrentModel}
        saveViewState={saveViewState}
        onChange={onChange}
        onMount={(editor, monaco) => {
          window.__monacoEditor__ = editor;
          onMount?.(editor, monaco);
        }}
        onValidate={onValidate}
        beforeMount={(monaco) => {
          monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            allowComments: false,
            trailingCommas: 'error',
            schemaValidation: 'ignore',
            enableSchemaRequest: false,
          });
        }}
        options={{
          ...jsonEditorOptions,
          ...options,
          readOnly,
        }}
      />
    </div>
  );
};
