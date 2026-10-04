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
import { Modal } from 'antd';

import { APP_CODE_EDITOR_FONT_SIZE, APP_MONOSPACE_FONT_FAMILY } from '@/config/typography';
import { useThemeMode } from '@/stores/global';

type Props = {
  open: boolean;
  original: string;
  modified: string;
  saving?: boolean;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  title?: string;
  description?: string;
  confirmText?: string;
};

/** The same read-only change review for form drafts and direct RAW edits. */
export const JsonChangeReview = ({
  open, original, modified, saving, onCancel, onSave,
  title = 'Review Changes Before Saving',
  description = 'Compare the saved configuration with your changes before applying them.',
  confirmText = 'Confirm & Save',
}: Props) => {
  const { mode } = useThemeMode();
  return (
    <Modal
      open={open}
      title={title}
      width={1000}
      onCancel={onCancel}
      onOk={onSave}
      okText={confirmText}
      cancelText="Keep editing"
      confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      mask={{ closable: !saving }}
      keyboard={!saving}
      destroyOnHidden
    >
      <p>{description}</p>
      <div style={{ border: '1px solid var(--ant-color-border)', borderRadius: 6, overflow: 'hidden' }}>
        <DiffEditor
          height="min(55vh, 500px)"
          language="json"
          theme={mode === 'dark' ? 'vs-dark' : 'vs-light'}
          original={original}
          modified={modified}
          options={{
            readOnly: true,
            originalEditable: false,
            minimap: { enabled: false },
            renderSideBySide: true,
            useInlineViewWhenSpaceIsLimited: true,
            automaticLayout: true,
            wordWrap: 'on',
            wrappingIndent: 'indent',
            fontFamily: APP_MONOSPACE_FONT_FAMILY,
            fontSize: APP_CODE_EDITOR_FONT_SIZE,
          }}
        />
      </div>
    </Modal>
  );
};
