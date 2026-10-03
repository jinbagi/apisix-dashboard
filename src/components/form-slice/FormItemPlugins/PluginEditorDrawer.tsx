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
import { Alert, Button, Drawer, message, Modal, Space, Tabs, Tooltip, Typography } from 'antd';
import { isEmpty, isNil } from 'rambdax';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';

import { FormSubmitBtn } from '@/components/form/Btn';
import { FormItemEditor } from '@/components/form/Editor';
import { SchemaForm } from '@/components/schema-form/SchemaForm';
import {
  applyJsonSchemaDefaults,
  buildJsonSchemaTemplate,
} from '@/components/schema-form/schemaTemplate';
import {
  type JSONSchema,
  validateSchemaValue,
} from '@/components/schema-form/schemaValidation';
import { sortJsonKeys } from '@/utils/apisixEditable';
import IconContentCopy from '~icons/material-symbols/content-copy';
import IconFormatAlignLeft from '~icons/material-symbols/format-align-left';
import IconRefresh from '~icons/material-symbols/refresh';

import {
  getAIGatewayTemplates,
  validateAIGatewayConfig,
} from './aiGateway';
import type { PluginCardListProps } from './PluginCardList';
import {
  getPluginCompatibilityNotices,
  validatePluginCompatibility,
} from './pluginCompatibility';
import { getPluginTemplates } from './pluginTemplates';

export type PluginConfig = { name: string; config: Record<string, unknown> };
export type PluginEditorDrawerProps = Pick<PluginCardListProps, 'mode'> & {
  opened: boolean;
  onClose: () => void;
  onSave: (props: PluginConfig) => void | Promise<void>;
  plugin: PluginConfig;
  schema?: object;
};

const toConfigStr = (p: object | undefined): string => {
  return !isEmpty(p) && !isNil(p) ? JSON.stringify(p, null, 2) : '{}';
};

const hasProperties = (schema: object | undefined): boolean => {
  if (!schema) return false;
  const s = schema as Record<string, unknown>;
  return typeof s.properties === 'object' && s.properties !== null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const getEditableConfig = (
  schema: object | undefined,
  config: Record<string, unknown> | undefined,
  mode: PluginCardListProps['mode']
): Record<string, unknown> => {
  const base = isRecord(config) ? { ...config } : {};
  return mode === 'add' ? buildJsonSchemaTemplate(schema, base) : base;
};

const MAX_LIVE_ISSUES = 5;

export const PluginEditorDrawer = (props: PluginEditorDrawerProps) => {
  const { opened, onSave, onClose, plugin, mode, schema } = props;
  const { name, config } = plugin;

  const canUseForm = hasProperties(schema);
  const defaultTab = canUseForm ? 'form' : 'json';
  const [activeTab, setActiveTab] = useState<string>(defaultTab);
  const [formValue, setFormValue] = useState<Record<string, unknown>>(
    getEditableConfig(schema, config, mode)
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const methods = useForm<{ config: string }>({
    criteriaMode: 'all',
    disabled: mode === 'view',
    defaultValues: { config: toConfigStr(getEditableConfig(schema, config, mode)) },
  });
  const jsonConfigText = useWatch({
    control: methods.control,
    name: 'config',
  });
  const closeAndReset = () => {
    setDiscardConfirmOpen(false);
    onClose();
    methods.reset();
    setFormValue(getEditableConfig(schema, config, mode));
    setActiveTab(defaultTab);
    setSaveError(null);
  };

  const hasDraftChanges = useMemo(() => {
    if (mode === 'view') return false;
    try {
      const draft = activeTab === 'json' ? JSON.parse(jsonConfigText ?? '') : formValue;
      return JSON.stringify(sortJsonKeys(draft)) !==
        JSON.stringify(sortJsonKeys(getEditableConfig(schema, config, mode)));
    } catch {
      // Incomplete JSON is still valuable work, even though it cannot be saved yet.
      return true;
    }
  }, [activeTab, config, formValue, jsonConfigText, mode, schema]);
  const handleClose = () => {
    if (methods.formState.isSubmitting) return;
    if (hasDraftChanges) setDiscardConfirmOpen(true);
    else closeAndReset();
  };

  useEffect(() => {
    const nextValue = getEditableConfig(schema, config, mode);
    methods.reset({ config: toConfigStr(nextValue) });
    setFormValue(nextValue);
  }, [config, methods, mode, schema]);

  useEffect(() => {
    setActiveTab(canUseForm ? 'form' : 'json');
  }, [canUseForm, name]);

  const applyJsonToFields = useCallback(() => {
    try {
      const parsed = JSON.parse(methods.getValues('config') || '{}') as unknown;
      if (!isRecord(parsed)) {
        setSaveError('Plugin config must be a JSON object.');
        return false;
      }
      setFormValue(parsed);
      setSaveError(null);
      return true;
    } catch {
      setSaveError('Fix the Plugin JSON syntax error before switching to Fields.');
      return false;
    }
  }, [methods]);

  const handleApplyJsonToFields = useCallback(() => {
    if (applyJsonToFields()) {
      setActiveTab('form');
    }
  }, [applyJsonToFields]);

  const handleTabChange = useCallback((key: string) => {
    if (key === 'json' && activeTab === 'form') {
      // Serialize form values to JSON editor
      methods.setValue('config', toConfigStr(formValue as object));
    } else if (key === 'form' && activeTab === 'json') {
      if (!applyJsonToFields()) {
        return;
      }
    }
    setActiveTab(key);
  }, [activeTab, applyJsonToFields, formValue, methods]);

  const handleFormChange = useCallback((val: Record<string, unknown>) => {
    setFormValue(val);
  }, []);

  const title = mode === 'add'
    ? 'Add Plugin'
    : mode === 'edit'
      ? 'Edit Plugin'
      : 'View Plugin';

  const getCurrentConfig = (): Record<string, unknown> => {
    if (activeTab === 'form') {
      return formValue;
    }
    try {
      const parsed = JSON.parse(methods.getValues('config') || '{}') as unknown;
      return isRecord(parsed) ? parsed : formValue;
    } catch {
      return formValue;
    }
  };

  const tabItems = [
    ...(canUseForm
      ? [
          {
            key: 'form',
            label: 'Fields',
            children: (
              <SchemaForm
                schema={schema as Record<string, unknown>}
                value={formValue}
                onChange={handleFormChange}
                disabled={mode === 'view'}
              />
            ),
          },
        ]
      : []),
    {
      key: 'json',
      label: 'Plugin JSON',
      children: (
        <FormItemEditor
          name="config"
          customSchema={schema}
          isLoading={!schema}
          height={420}
          required
        />
      ),
    },
  ];
  const aiTemplates =
    mode === 'add' ? getAIGatewayTemplates(name) : [];
  const pluginTemplates = mode === 'add'
    ? getPluginTemplates(name, schema as JSONSchema | undefined)
    : [];
  const compatibilityNotices = getPluginCompatibilityNotices(
    name,
    getCurrentConfig()
  );

  const applyTemplate = (template: Record<string, unknown>) => {
    const nextValue = mode === 'add'
      ? buildJsonSchemaTemplate(schema, template)
      : applyJsonSchemaDefaults(schema, template);
    setFormValue(nextValue);
    methods.setValue('config', toConfigStr(nextValue));
    setActiveTab(canUseForm ? 'form' : 'json');
    setSaveError(null);
  };

  const formatJsonConfig = useCallback(() => {
    try {
      const parsed = JSON.parse(methods.getValues('config') || '{}');
      if (!isRecord(parsed)) {
        setSaveError('Plugin config must be a JSON object.');
        return;
      }
      const formatted = toConfigStr(parsed);
      methods.setValue('config', formatted, { shouldDirty: true });
      setFormValue(parsed);
      setSaveError(null);
      message.success('Plugin JSON formatted');
    } catch (error) {
      setSaveError(`Invalid JSON: ${String(error)}`);
    }
  }, [methods]);

  const copyJsonConfig = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(methods.getValues('config') || '{}');
      message.success('Plugin JSON copied');
    } catch {
      message.error('Failed to copy Plugin JSON');
    }
  }, [methods]);

  const resetJsonConfig = useCallback(() => {
    const nextValue = getEditableConfig(schema, config, mode);
    methods.setValue('config', toConfigStr(nextValue), { shouldDirty: true });
    setFormValue(nextValue);
    setSaveError(null);
  }, [config, methods, mode, schema]);
  const jsonValidation = useMemo(() => {
    if (activeTab !== 'json' || mode === 'view') return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonConfigText || '{}');
    } catch (error) {
      return {
        message: 'Fix Plugin JSON syntax before saving.',
        issues: [error instanceof Error ? error.message : String(error)],
      };
    }

    if (!isRecord(parsed)) {
      return {
        message: 'Plugin config must be a JSON object.',
        issues: ['The top-level JSON value is not an object.'],
      };
    }

    const issues = [
      ...validateSchemaValue(schema as JSONSchema | undefined, parsed),
      ...validateAIGatewayConfig(name, parsed),
      ...validatePluginCompatibility(name, parsed),
    ];
    if (issues.length === 0) return null;

    return {
      message: `${issues.length} plugin config issue${issues.length === 1 ? '' : 's'}`,
      issues,
    };
  }, [activeTab, jsonConfigText, mode, name, schema]);
  const saveErrorActions =
    activeTab === 'json' && mode !== 'view' ? (
      <Space wrap>
        <Button
          size="small"
          icon={<IconFormatAlignLeft />}
          onClick={formatJsonConfig}
          aria-label="Format Plugin JSON after error"
        >
          Format Plugin JSON
        </Button>
        <Button
          size="small"
          icon={<IconRefresh />}
          onClick={resetJsonConfig}
          aria-label="Reset Plugin JSON after error"
        >
          Reset Plugin JSON
        </Button>
      </Space>
    ) : undefined;

  const handleSave = methods.handleSubmit(
    async () => {
      setSaveError(null);
      const cfg = getCurrentConfig();
      if (activeTab === 'json') {
        try {
          const parsed = JSON.parse(methods.getValues('config') || '{}') as unknown;
          if (!isRecord(parsed)) {
            setSaveError('Plugin config must be a JSON object.');
            return;
          }
        } catch (error) {
          setSaveError(`Invalid JSON: ${String(error)}`);
          return;
        }
      }
      const schemaIssues = validateSchemaValue(
        schema as JSONSchema | undefined,
        cfg
      );
      const aiGatewayIssues = validateAIGatewayConfig(name, cfg);
      const compatibilityIssues = validatePluginCompatibility(name, cfg);
      const issues = [
        ...schemaIssues,
        ...aiGatewayIssues,
        ...compatibilityIssues,
      ];
      if (issues.length > 0) {
        setSaveError(issues.join('\n'));
        return;
      }
      try {
        await onSave({ name, config: cfg });
        closeAndReset();
      } catch (error) {
        setSaveError(
          `Save or verification failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },
    (errors) => {
      const messages = Object.entries(errors)
        .map(([key, value]) =>
          `${key}: ${(value as { message?: string })?.message ?? 'invalid'}`
        )
        .join('\n');
      setSaveError(messages || 'Validation failed');
    }
  );

  return (
    <FormProvider {...methods}>
      <Drawer
        placement="right"
        styles={{
          wrapper: { width: 620, maxWidth: '100vw' },
          body: { paddingTop: '18px' },
        }}
        keyboard={false}
        open={opened}
        onClose={handleClose}
        title={`${title}: ${name}`}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={handleClose} disabled={methods.formState.isSubmitting}>
              {mode === 'view' ? 'Close' : 'Cancel'}
            </Button>
            {mode !== 'view' && (
              <FormSubmitBtn type="primary" onClick={handleSave}>
                {mode === 'add' ? 'Add Plugin' : 'Save Changes'}
              </FormSubmitBtn>
            )}
          </div>
        }
      >
        {schema && typeof schema === 'object' && 'description' in schema && (
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 'var(--app-font-size-md)' }}>
            {String((schema as { description: string }).description)}
          </Typography.Text>
        )}
        {aiTemplates.length > 0 && (
          <Alert
            type="info"
            showIcon
            message="AI Gateway quick start"
            description={
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text type="secondary">
                  Choose a provider template, then replace model, endpoint, and Secret
                  Reference placeholders for your environment.
                </Typography.Text>
                <Space wrap>
                  {aiTemplates.map((template) => (
                    <Button
                      key={template.key}
                      onClick={() => applyTemplate(template.config)}
                      title={template.description}
                    >
                      {template.label}
                    </Button>
                  ))}
                </Space>
              </Space>
            }
            style={{ marginBottom: 12 }}
          />
        )}
        {pluginTemplates.length > 0 && (
          <Space wrap style={{ marginBottom: 12 }}>
            {pluginTemplates.map((template) => (
              <Button key={template.label} onClick={() => applyTemplate(template.config)}>
                {template.label}
              </Button>
            ))}
          </Space>
        )}
        {compatibilityNotices.map((notice) => (
          <Alert
            key={notice.key}
            type={notice.type}
            showIcon
            message={notice.message}
            description={notice.description}
            style={{ marginBottom: 12 }}
          />
        ))}
        {activeTab === 'json' && mode !== 'view' && (
          <Space style={{ width: '100%', justifyContent: 'flex-end', marginBottom: 8 }}>
            {canUseForm && (
              <Button size="small" onClick={handleApplyJsonToFields}>
                Apply to Fields
              </Button>
            )}
            <Tooltip title="Format Plugin JSON">
              <Button
                size="small"
                icon={<IconFormatAlignLeft />}
                onClick={formatJsonConfig}
                aria-label="Format Plugin JSON"
              />
            </Tooltip>
            <Tooltip title="Copy Plugin JSON">
              <Button
                size="small"
                icon={<IconContentCopy />}
                onClick={copyJsonConfig}
                aria-label="Copy Plugin JSON"
              />
            </Tooltip>
            <Tooltip title="Reset Plugin JSON">
              <Button
                size="small"
                icon={<IconRefresh />}
                onClick={resetJsonConfig}
                aria-label="Reset Plugin JSON"
              />
            </Tooltip>
          </Space>
        )}
        {jsonValidation && (
          <Alert
            type="warning"
            showIcon
            message={jsonValidation.message}
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {jsonValidation.issues.slice(0, MAX_LIVE_ISSUES).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
                {jsonValidation.issues.length > MAX_LIVE_ISSUES && (
                  <li>
                    {jsonValidation.issues.length - MAX_LIVE_ISSUES} more issue
                    {jsonValidation.issues.length - MAX_LIVE_ISSUES === 1 ? '' : 's'}
                  </li>
                )}
              </ul>
            }
            style={{ marginBottom: 8 }}
          />
        )}
        {mode !== 'view' && saveError && (
          <Alert
            type="error"
            showIcon
            message={saveError}
            action={saveErrorActions}
            closable
            onClose={() => setSaveError(null)}
            style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }}
          />
        )}
        <form>
          {canUseForm ? (
            <Tabs
              activeKey={activeTab}
              onChange={handleTabChange}
              items={tabItems}
            />
          ) : (
            <FormItemEditor
              name="config"
              customSchema={schema}
              isLoading={!schema}
              height={420}
              required
            />
          )}
        </form>
      </Drawer>
      <Modal
        open={discardConfirmOpen}
        title="Discard plugin changes?"
        onCancel={() => setDiscardConfirmOpen(false)}
        onOk={closeAndReset}
        okText="Discard changes"
        cancelText="Keep editing"
        okButtonProps={{ danger: true }}
        cancelButtonProps={{ autoFocus: true }}
      >
        Changes to {name} have not been applied. Keep editing to finish your
        configuration, or discard this plugin draft.
      </Modal>
    </FormProvider>
  );
};
