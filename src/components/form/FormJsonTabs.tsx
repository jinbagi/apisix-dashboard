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
import { useBlocker, useRouter } from '@tanstack/react-router';
import type { TabsProps } from 'antd';
import { Alert, Button, Modal, Space, Tabs } from 'antd';
import axios from 'axios';
import { clsx } from 'clsx';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { ZodTypeAny } from 'zod';

import { JsonCodeEditor } from '@/components/form/JsonCodeEditor';
import { AdminApiJsonEditor } from '@/components/page/AdminApiJsonEditor';
import { ResourceOverview } from '@/components/page/ResourceOverview';
import { queryClient } from '@/config/global';
import { getRequestErrorMessage } from '@/config/req';
import {
  isRecord,
  mergeIdentityPayload,
  restorePatchReadonlyFields,
  sortJsonKeys,
  stripSystemReadonlyFields,
  stripSystemTimestamps,
} from '@/utils/apisixEditable';
import { FormDraftRevisionContext, FormTOCCtx } from '@/utils/form-context';
import { RESOURCE_DELETED_EVENT, revealFormTarget } from '@/utils/formNavigation';

import { FormSubmitBtn } from './Btn';
import classes from './FormJsonTabs.module.css';
import { JsonChangeReview } from './JsonChangeReview';
import { JsonSchemaGuide } from './JsonSchemaGuide';

const EDITOR_PREFERENCE_KEY = 'resource-editor:preferred-tab';

function flattenErrors(
  errors: Record<string, unknown>,
  prefix = ''
): Array<{ path: string; message: string }> {
  const result: Array<{ path: string; message: string }> = [];
  for (const [key, value] of Object.entries(errors)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && 'message' in value) {
      result.push({ path, message: String((value as { message: string }).message) });
    } else if (value && typeof value === 'object') {
      result.push(...flattenErrors(value as Record<string, unknown>, path));
    }
  }
  return result;
}

function hasAnyDirtyField(dirtyFields: unknown): boolean {
  if (!dirtyFields || typeof dirtyFields !== 'object') return false;
  return Object.values(dirtyFields as Record<string, unknown>).some((value) => {
    if (value === true) return true;
    if (value && typeof value === 'object') return hasAnyDirtyField(value);
    return false;
  });
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatErrorPath(path: string): string {
  if (path.startsWith('plugins.')) {
    const parts = path.split('.');
    const pluginName = parts[1];
    const fieldName = parts.slice(2).join(' > ');
    return `Plugin: ${pluginName} > ${fieldName || 'Config'}`;
  }

  let readable = path;
  readable = readable.replace(/\.(\d+)\./g, (_match, p1) => ` #${Number(p1) + 1} > `);
  readable = readable.replace(/\.(\d+)$/g, (_match, p1) => ` #${Number(p1) + 1}`);

  const labelMap: Record<string, string> = {
    uri: 'Request Path (URI)',
    uris: 'Request Paths (URIs)',
    name: 'Name',
    desc: 'Description',
    host: 'Host',
    hosts: 'Hosts',
    port: 'Port',
    weight: 'Weight',
    priority: 'Priority',
    upstream: 'Upstream',
    nodes: 'Target Nodes',
    timeout: 'Timeout',
    connect: 'Connect Timeout',
    send: 'Send Timeout',
    read: 'Read Timeout',
    type: 'Type',
    username: 'Username',
    plugins: 'Plugins',
    pass_host: 'Pass Host',
    upstream_id: 'Upstream ID',
    service_id: 'Service ID',
  };

  const segments = readable.split('.');
  const formattedSegments = segments.map((seg) => {
    const trimmed = seg.trim();
    return labelMap[trimmed] || trimmed;
  });

  return formattedSegments.join(' > ');
}

const FormErrorSummary = ({
  errors,
  onFocusError,
}: {
  errors: Array<{ path: string; message: string }>;
  onFocusError: (path: string) => void;
}) => {
  if (errors.length === 0) return null;
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 16 }}
      title={`${errors.length} validation error(s)`}
      description={
        <ul className={classes.errorList}>
          {errors.slice(0, 10).map((e) => (
            <li key={e.path} className={classes.errorItem}>
              <button
                type="button"
                className={classes.errorLink}
                onClick={() => onFocusError(e.path)}
              >
                <strong className={classes.errorPath}>{formatErrorPath(e.path)}</strong>
                <span>{e.message}</span>
              </button>
            </li>
          ))}
          {errors.length > 10 && <li>...and {errors.length - 10} more</li>}
        </ul>
      }
    />
  );
};

type FormJsonTabsProps = {
  children: React.ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSubmit: (data: any) => unknown;
  /** Convert UI values to the exact payload shown in JSON and the save diff. */
  preparePayload?: (data: Record<string, unknown>) => Record<string, unknown>;
  submitLabel?: string;
  disabled?: boolean;
  /** Raw API response data — shown as the Admin API JSON tab so users can see actual APISIX state */
  rawData?: unknown;
  /** Admin API endpoint for direct JSON editing, e.g. '/routes/123'. */
  adminApi?: string;
  /** The exact schema used by this form, also shown as guidance in Payload JSON mode. */
  schema?: ZodTypeAny;
  /** Minimal create payload containing only required fields. */
  createJsonTemplate?: Record<string, unknown>;
  /** Resource-specific detail tabs shown between Configuration and Admin API JSON. */
  detailTabs?: NonNullable<TabsProps['items']>;
  /** Resource context used to show reverse dependencies in Overview. */
  overviewReferenceContext?: {
    resourceType: 'upstream' | 'service';
    resourceId: string;
  };
};

const FormActionBar = ({
  children,
  errorCount,
  hasUnsavedChanges,
  idleText = 'No pending changes',
  isSaving,
  onFocusFirstError,
  onRevert,
}: {
  children: React.ReactNode;
  errorCount: number;
  hasUnsavedChanges: boolean;
  idleText?: string;
  isSaving: boolean;
  onFocusFirstError: () => void;
  onRevert?: () => void;
}) => {
  let dotClass = classes.statusDotSuccess;
  let statusText = idleText;

  if (isSaving) {
    dotClass = classes.statusDotWarning;
    statusText = 'Saving and reloading from APISIX...';
  } else if (errorCount > 0) {
    dotClass = classes.statusDotError;
    statusText = `${errorCount} validation error${errorCount === 1 ? '' : 's'}`;
  } else if (hasUnsavedChanges) {
    dotClass = classes.statusDotWarning;
    statusText = 'Unsaved changes';
  }

  const shouldStick = isSaving || errorCount > 0 || hasUnsavedChanges;

  return (
    <div className={clsx(classes.actionBar, shouldStick && classes.actionBarSticky)}>
      <div className={clsx(classes.actionPanel, shouldStick && classes.actionPanelSticky)}>
        <div className={classes.actionStatusWrapper}>
          <span className={clsx(classes.statusDot, dotClass)} />
          <span className={classes.actionStatus} aria-live="polite">
            {statusText}
          </span>
        </div>
        <Space wrap>
          {errorCount > 0 && (
            <Button danger size="middle" disabled={isSaving} onClick={onFocusFirstError}>
              Review first error
            </Button>
          )}
          {hasUnsavedChanges && onRevert && (
            <Button size="middle" disabled={isSaving} onClick={onRevert}>
              Revert changes
            </Button>
          )}
          {children}
        </Space>
      </div>
    </div>
  );
};

export const FormJsonTabs = (props: FormJsonTabsProps) => {
  const {
    children,
    form,
    onSubmit,
    preparePayload,
    submitLabel = 'Submit',
    disabled = false,
    rawData,
    adminApi,
    schema,
    createJsonTemplate,
    detailTabs = [],
    overviewReferenceContext,
  } = props;
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<string>('form');
  const restoredEditor = useRef(false);
  const selectEditorTab = useCallback((key: string, remember = true) => {
    setActiveTab(key);
    if (remember && ['form', 'json', 'raw'].includes(key)) {
      try { localStorage.setItem(EDITOR_PREFERENCE_KEY, key); }
      catch { /* Browser storage is optional. */ }
    }
  }, []);
  const [jsonStr, setJsonStr] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [jsonTabDirty, setJsonTabDirty] = useState<boolean>(false);
  const [rawTabDirty, setRawTabDirty] = useState<boolean>(false);
  const [rawTabSaving, setRawTabSaving] = useState<boolean>(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const [rawRevision, setRawRevision] = useState(0);
  const { refreshTOC } = useContext(FormTOCCtx);
  useEffect(() => { refreshTOC(); }, [activeTab, refreshTOC]);
  const pendingSubmitRef = useRef<unknown>(null);

  const formHasUnsavedChanges =
    hasAnyDirtyField(form.formState.dirtyFields) && !disabled;
  const jsonHasUnsavedChanges =
    (formHasUnsavedChanges || jsonTabDirty) && !disabled;
  const saveInProgress = isSaving || rawTabSaving;
  const deletedResourceRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const handleDeleted = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === adminApi) {
        deletedResourceRef.current = adminApi;
      }
    };
    window.addEventListener(RESOURCE_DELETED_EVENT, handleDeleted);
    return () => window.removeEventListener(RESOURCE_DELETED_EVENT, handleDeleted);
  }, [adminApi]);
  const hasUnsavedDraft = jsonHasUnsavedChanges || rawTabDirty;
  const draftIsObsolete = () => !!adminApi && deletedResourceRef.current === adminApi;
  const navigationBlocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname && hasUnsavedDraft &&
      !saveInProgress && !draftIsObsolete(),
    enableBeforeUnload: () =>
      (hasUnsavedDraft || saveInProgress) && !draftIsObsolete(),
    withResolver: true,
  });
  const validationErrors = flattenErrors(form.formState.errors);
  const idleStatusText =
    rawData === undefined ? 'Fill required fields, then submit' : 'No pending changes';

  const focusFormError = useCallback(
    (path: string) => {
      setActiveTab('form');
      window.requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(
          `[data-form-field="${escapeAttributeValue(path)}"]`
        );
        if (target) {
          revealFormTarget(target);
          window.requestAnimationFrame(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            form.setFocus(path, { shouldSelect: true });
          });

          target.classList.add('form-field-error-shake');
          setTimeout(() => {
            target.classList.remove('form-field-error-shake');
          }, 600);

          return;
        }

        if (path.startsWith('plugins.')) {
          const parts = path.split('.');
          const pluginName = parts[1];
          if (pluginName) {
            const editBtn = document.querySelector<HTMLButtonElement>(
              `[data-testid="plugin-${pluginName}-edit"], [data-testid="plugin-${pluginName}-view"]`
            );
            if (editBtn) {
              editBtn.click();
              setTimeout(() => {
                const subTarget = document.querySelector<HTMLElement>(
                  `[data-form-field="${escapeAttributeValue(path)}"]`
                );
                if (subTarget) {
                  subTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  form.setFocus(path, { shouldSelect: true });

                  subTarget.classList.add('form-field-error-shake');
                  setTimeout(() => {
                    subTarget.classList.remove('form-field-error-shake');
                  }, 600);
                }
              }, 150);
            }
          }
        }
      });
    },
    [form]
  );

  const focusFirstFormError = useCallback(() => {
    const firstError = flattenErrors(form.formState.errors)[0];
    if (firstError) {
      focusFormError(firstError.path);
    }
  }, [focusFormError, form.formState.errors]);

  const handleRevert = useCallback(() => {
    Modal.confirm({
      title: 'Discard all unsaved changes?',
      content: 'Are you sure you want to revert all changes to the last saved state?',
      okText: 'Revert',
      cancelText: 'Cancel',
      okButtonProps: { danger: true },
      onOk: () => {
        form.reset();
        setDraftRevision((revision) => revision + 1);
        if (activeTab === 'json') {
          const values = form.getValues() as Record<string, unknown>;
          const sanitizedValues = rawData ? stripSystemReadonlyFields(values) : values;
          setJsonStr(JSON.stringify(sortJsonKeys(preparePayload ? preparePayload(sanitizedValues) : sanitizedValues), null, 2));
          setJsonTabDirty(false);
          setJsonError(null);
        }
        setRawTabDirty(false);
      },
    });
  }, [form, activeTab, rawData, preparePayload]);

  const doSubmit = useCallback(
    async (payload: unknown) => {
      if (isSaving) return;
      setApiError(null);
      setIsSaving(true);
      try {
        await onSubmit(payload);
        form.reset(
          rawData === undefined ? payload : form.getValues(),
          { keepDefaultValues: false }
        );
        setJsonTabDirty(false);
        setDraftRevision((revision) => revision + 1);
      } catch (e) {
        const msg = axios.isAxiosError(e)
          ? getRequestErrorMessage(e)
          : e instanceof Error
            ? e.message
            : String(e);
        setApiError(`Save or verification failed: ${msg}`);
      } finally {
        setIsSaving(false);
      }
    },
    [form, isSaving, onSubmit, rawData]
  );

  // Show diff modal before saving when rawData is available (edit mode)
  const safeSubmit = useCallback(
    async (data: unknown) => {
      const prepared = preparePayload && isRecord(data) ? preparePayload(data) : data;
      const payload = rawData === undefined
        ? prepared
        : mergeIdentityPayload(rawData, prepared);

      if (rawData) {
        pendingSubmitRef.current = payload;
        setDiffModalOpen(true);
      } else {
        await doSubmit(payload);
      }
    },
    [doSubmit, rawData, preparePayload]
  );

  const confirmDiffAndSave = useCallback(async () => {
    setDiffModalOpen(false);
    if (pendingSubmitRef.current) {
      await doSubmit(pendingSubmitRef.current);
      pendingSubmitRef.current = null;
    }
  }, [doSubmit]);

  const applyJsonToForm = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonStr || '{}') as Record<string, unknown>;
      if (!isRecord(parsed)) throw new Error('Payload must be a JSON object');
      const sanitizedParsed = rawData ? stripSystemReadonlyFields(parsed) : parsed;
      form.reset(isRecord(rawData) ? restorePatchReadonlyFields(sanitizedParsed, rawData) : sanitizedParsed, { keepDefaultValues: true });
      setDraftRevision((revision) => revision + 1);
      setJsonTabDirty(false);
      setJsonError(null);
      void form.trigger();
      return true;
    } catch (e) {
      setJsonError('Invalid JSON: ' + String(e));
      return false;
    }
  }, [form, jsonStr, rawData]);

  const handleApplyJsonToForm = useCallback(() => {
    if (applyJsonToForm()) {
      selectEditorTab('form');
    }
  }, [applyJsonToForm, selectEditorTab]);

  const handleTabChange = useCallback(
    (key: string, remember = true) => {
      if (saveInProgress) return;

      if (key === 'raw' && jsonHasUnsavedChanges) {
        Modal.confirm({
          title: 'Discard this draft and open saved API state?',
          content: 'Admin API JSON edits the saved resource separately. Use Payload JSON to continue editing this draft.',
          okText: 'Discard draft', cancelText: 'Keep editing', okButtonProps: { danger: true },
          onOk: () => { form.reset(); setJsonTabDirty(false); setDraftRevision((revision) => revision + 1); selectEditorTab(key, remember); },
        });
        return;
      }
      if (activeTab === 'raw' && rawTabDirty) {
        Modal.confirm({
          title: 'Discard unsaved Admin API JSON changes?',
          content: 'These changes have not been saved. Cancel to continue editing them.',
          okText: 'Discard changes', cancelText: 'Keep editing', okButtonProps: { danger: true },
          onOk: () => {
            setRawRevision((revision) => revision + 1);
            setRawTabDirty(false);
            if (key === 'json') {
              const values = stripSystemReadonlyFields(form.getValues());
              setJsonStr(JSON.stringify(sortJsonKeys(preparePayload ? preparePayload(values) : values), null, 2));
              setJsonTabDirty(false);
              setJsonError(null);
            }
            selectEditorTab(key, remember);
          },
        });
        return;
      }
      if (key === 'json' && activeTab !== 'json') {
        const values = form.getValues() as Record<string, unknown>;
        const useCreateTemplate =
          rawData === undefined &&
          !hasAnyDirtyField(form.formState.touchedFields) &&
          !hasAnyDirtyField(form.formState.dirtyFields) &&
          createJsonTemplate !== undefined;
        const sanitizedValues = useCreateTemplate
          ? createJsonTemplate
          : rawData
            ? stripSystemReadonlyFields(values)
            : values;
        setJsonStr(JSON.stringify(sortJsonKeys(preparePayload ? preparePayload(sanitizedValues) : sanitizedValues), null, 2));
        setJsonTabDirty(false);
        setJsonError(null);
      } else if (activeTab === 'json') {
        if (!applyJsonToForm()) {
          return;
        }
      }
      selectEditorTab(key, remember);
    },
    [
      activeTab,
      applyJsonToForm,
      createJsonTemplate,
      preparePayload,
      form,
      rawData,
      saveInProgress,
      jsonHasUnsavedChanges,
      rawTabDirty,
      selectEditorTab,
    ]
  );

  useEffect(() => {
    if (restoredEditor.current) return;
    // Resource pages initialize transformed form values in their mount effects.
    // Restore the editor after those effects, through the normal draft transfer.
    const frame = requestAnimationFrame(() => {
      restoredEditor.current = true;
      try {
        const preferred = localStorage.getItem(EDITOR_PREFERENCE_KEY);
        if (preferred === 'json' || preferred === 'raw') {
          handleTabChange(preferred === 'raw' && rawData === undefined ? 'json' : preferred, false);
        }
      } catch { /* Browser storage is optional. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [handleTabChange, rawData]);

  const handleJsonSubmit = useCallback(async () => {
    setJsonError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr || '{}') as Record<string, unknown>;
      if (!isRecord(parsed)) throw new Error('Payload must be a JSON object');
      if (rawData) {
        parsed = stripSystemReadonlyFields(parsed);
      }
    } catch (e) {
      setJsonError('Invalid JSON: ' + String(e));
      return;
    }
    // Reset form with parsed values then trigger Zod validation via handleSubmit
    form.reset(isRecord(rawData) ? restorePatchReadonlyFields(parsed, rawData) : parsed, { keepDefaultValues: true });
    setDraftRevision((revision) => revision + 1);
    setJsonTabDirty(false);
    setIsSubmitting(true);
    try {
      await form.handleSubmit(
        safeSubmit,
        (errors) => {
          const flat = flattenErrors(errors);
          if (flat.length > 0) {
            setJsonError(
              `Validation failed:\n${flat.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`
            );
          }
        }
      )();
    } finally {
      setIsSubmitting(false);
    }
  }, [jsonStr, form, safeSubmit, rawData]);

  const handleCancel = useCallback(() => {
    router.history.back();
  }, [router]);

  const configurationTab = {
    key: 'form',
    label: rawData === undefined ? 'Visual Editor' : 'Configuration',
    children: (
      <form
        noValidate
        onSubmit={form.handleSubmit(safeSubmit, (errors) => {
          const firstError = flattenErrors(errors)[0];
          if (firstError) {
            focusFormError(firstError.path);
          }
        })}
      >
        {apiError && (
          <Alert type="error" showIcon closable title={apiError} onClose={() => setApiError(null)} style={{ marginBottom: 16 }} />
        )}
        <FormErrorSummary errors={validationErrors} onFocusError={focusFormError} />
        <FormDraftRevisionContext.Provider value={draftRevision}>
          <fieldset disabled={isSaving} inert={isSaving} style={{ minWidth: 0, border: 0, margin: 0, padding: 0 }}>{children}</fieldset>
        </FormDraftRevisionContext.Provider>
        {!disabled && (
          <FormActionBar
            errorCount={validationErrors.length}
            hasUnsavedChanges={formHasUnsavedChanges}
            idleText={idleStatusText}
            isSaving={isSaving}
            onFocusFirstError={focusFirstFormError}
            onRevert={handleRevert}
          >
            <FormSubmitBtn
              loading={isSaving}
              disabled={isSaving || (rawData !== undefined && !formHasUnsavedChanges)}
            >
              {submitLabel}
            </FormSubmitBtn>
            <Button size="middle" disabled={isSaving} onClick={handleCancel}>
              Cancel
            </Button>
          </FormActionBar>
        )}
      </form>
    ),
  };

  const tabItems: NonNullable<TabsProps['items']> = rawData === undefined
    ? [configurationTab]
    : [
        configurationTab,
        ...detailTabs,
      ];

  {
    tabItems.splice(1, 0, {
      key: 'json',
      label: 'Payload JSON',
      children: (
        <div>
          {apiError && <Alert type="error" showIcon title={apiError} style={{ marginBottom: 12 }} />}
          <Alert
            type="info"
            showIcon
            title="One draft, two editors"
            description="Payload JSON and the form share your changes, validation, and save review. Switching to the form applies your JSON without saving."
            style={{ marginBottom: 12, padding: '8px 12px', fontSize: 'var(--app-font-size-sm)' }}
          />
          {schema && <JsonSchemaGuide schema={schema} value={jsonStr} compact />}
          <div style={{ resize: 'vertical', height: 500, minHeight: 300, maxHeight: 1200 }}>
            <JsonCodeEditor
              height="100%"
              value={jsonStr}
              onChange={(nextValue) => {
                if (isSaving) return;
                setJsonStr(nextValue ?? '');
                setJsonTabDirty(true);
                setJsonError(null);
              }}
              readOnly={disabled || isSaving}
              hasError={!!jsonError}
            />
          </div>
          {jsonError && (
            <Alert
              type="error"
              title={<div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--app-font-monospace)', fontSize: 'var(--app-font-size-sm)' }}>{jsonError}</div>}
              style={{ marginTop: 8 }}
              showIcon
            />
          )}
          {!disabled && (
            <FormActionBar
              errorCount={validationErrors.length}
              hasUnsavedChanges={jsonHasUnsavedChanges}
              idleText={idleStatusText}
              isSaving={isSaving}
              onFocusFirstError={focusFirstFormError}
              onRevert={handleRevert}
            >
              <Button
                size="middle"
                disabled={isSubmitting || isSaving}
                onClick={handleApplyJsonToForm}
              >
                Apply to Visual Editor
              </Button>
              <Button
                type="primary"
                size="middle"
                loading={isSubmitting || isSaving}
                disabled={isSubmitting || isSaving || (rawData !== undefined && !jsonHasUnsavedChanges)}
                onClick={handleJsonSubmit}
              >
                {submitLabel}
              </Button>
              <Button size="middle" disabled={isSaving} onClick={handleCancel}>
                Cancel
              </Button>
            </FormActionBar>
          )}
        </div>
      ),
    });
  }
  if (rawData !== undefined) {
    tabItems.push({
      key: 'raw',
      label: 'Admin API JSON',
      children: (
        <AdminApiJsonEditor
          key={rawRevision}
          api={adminApi ?? ''}
          disabled={disabled || !adminApi}
          height="500px"
          initialData={rawData as Record<string, unknown>}
          onDirtyChange={setRawTabDirty}
          onSaved={async () => {
            await queryClient.invalidateQueries();
          }}
          onSavingChange={setRawTabSaving}
        />
      ),
    });
    tabItems.push({
      key: 'overview',
      label: 'Overview',
      children: <ResourceOverview data={rawData} referenceContext={overviewReferenceContext} />,
    });
  }

  const diffOriginal = isRecord(rawData)
    ? JSON.stringify(sortJsonKeys(stripSystemTimestamps(rawData)), null, 2)
    : '{}';
  const diffModified = pendingSubmitRef.current
    ? JSON.stringify(
        sortJsonKeys(
          isRecord(pendingSubmitRef.current)
            ? stripSystemTimestamps(pendingSubmitRef.current)
            : pendingSubmitRef.current
        ),
        null,
        2
      )
    : '{}';
  return (
    <>
      <Tabs
        className={classes.workspaceTabs}
        activeKey={activeTab}
        onChange={handleTabChange}
        items={tabItems}
      />
      <Modal
        open={navigationBlocker.status === 'blocked'}
        title="Leave without saving?"
        onCancel={() => navigationBlocker.reset?.()}
        onOk={() => navigationBlocker.proceed?.()}
        okText="Discard and leave"
        cancelText="Keep editing"
        okButtonProps={{ danger: true }}
        cancelButtonProps={{ autoFocus: true }}
      >
        Your unsaved form or JSON changes will be lost. Keep editing to review
        and save them, or discard this draft to leave the page.
      </Modal>
      <JsonChangeReview
        open={diffModalOpen}
        onCancel={() => { setDiffModalOpen(false); pendingSubmitRef.current = null; }}
        onSave={confirmDiffAndSave}
        saving={isSaving}
        original={diffOriginal}
        modified={diffModified}
      />
    </>
  );
};
