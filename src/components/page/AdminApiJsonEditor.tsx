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
import { Alert, Button, message, Space, Tooltip, Typography } from 'antd';
import type { editor } from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZodIssue } from 'zod';

import { applyBulkPatch } from '@/apis/bulk-patch';
import { JsonChangeReview } from '@/components/form/JsonChangeReview';
import { JsonCodeEditor } from '@/components/form/JsonCodeEditor';
import { JsonSchemaGuide } from '@/components/form/JsonSchemaGuide';
import { ConfigurationImpact } from '@/components/page/ConfigurationImpact';
import { LocalRawDraft } from '@/components/page/LocalRawDraft';
import { RawJsonNavigation } from '@/components/page/RawJsonNavigation';
import { ResourceHistory } from '@/components/page/ResourceHistory';
import { queryClient } from '@/config/global';
import { req } from '@/config/req';
import { recordResourceChange } from '@/stores/resourceHistory';
import {
  buildPatchPayload,
  getChangedTopLevelReadonlyKeys,
  getPatchConflictPaths,
  getPatchMismatchPaths,
  isRecord,
  restorePatchReadonlyFields,
  sortJsonKeys,
  stripPatchReadonlyFields,
  stripSystemReadonlyFields,
} from '@/utils/apisixEditable';
import { showNotification } from '@/utils/notification';
import {
  getAdminResourceSchema,
  getResourceConditionalRequirements,
  getResourceIdentityPaths,
} from '@/utils/resourceJsonSchema';

import classes from './AdminApiJsonEditor.module.css';

function normalizeApiResource(apiPath: string, data: Record<string, unknown>): Record<string, unknown> {
  const secretMatch = apiPath.match(/^\/secrets\/([^/]+)\/(.+)$/);
  if (!secretMatch) return data;

  const [, manager, id] = secretMatch;
  return {
    ...data,
    id: decodeURIComponent(id),
    manager,
  };
}

type SaveFeedback = {
  type: 'success' | 'error' | 'warning';
  message: string;
  at: string;
};

export type AdminApiJsonEditorProps = {
  api: string;
  active?: boolean;
  disabled?: boolean;
  autoFetch?: boolean;
  height?: string;
  fillAvailable?: boolean;
  initialData?: Record<string, unknown>;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void | Promise<void>;
  onSavingChange?: (saving: boolean) => void;
};

const toJson = (data: Record<string, unknown>) => JSON.stringify(sortJsonKeys(data), null, 2);

const getAdminApiErrorMessage = (error: unknown) => {
  const responseData = (error as { response?: { data?: unknown } }).response?.data;
  if (responseData !== undefined) {
    if (typeof responseData === 'string') return responseData;
    try {
      return JSON.stringify(responseData, null, 2);
    } catch {
      return String(responseData);
    }
  }

  return error instanceof Error ? error.message : String(error);
};

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });

const verifySavedResource = async (
  api: string,
  payload: Record<string, unknown>
) => {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const latest = await req.get(api);
      const latestData = latest.data?.value as Record<string, unknown> | undefined;
      if (!isRecord(latestData)) {
        throw new Error('Admin API returned no resource value');
      }

      const normalizedResource = normalizeApiResource(api, latestData);
      const editorResource = stripPatchReadonlyFields(normalizedResource);
      const mismatches = getPatchMismatchPaths(payload, editorResource);
      if (mismatches.length === 0) return normalizedResource;

      lastError = new Error(
        `Admin API did not return the saved value for: ${mismatches.join(', ')}`
      );
    } catch (error) {
      lastError = error;
    }

    if (attempt < 2) await wait(250 * (attempt + 1));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Could not verify the saved resource');
};

export const AdminApiJsonEditor = ({
  api,
  active = true,
  disabled = false,
  autoFetch = false,
  height = '500px',
  fillAvailable = false,
  initialData,
  onDirtyChange,
  onSaved,
  onSavingChange,
}: AdminApiJsonEditorProps) => {
  const [value, setValue] = useState('');
  const [codeEditor, setCodeEditor] = useState<editor.IStandaloneCodeEditor | null>(null);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<{ original: string; modified: string } | null>(null);
  const [conflict, setConflict] = useState<{ latest: Record<string, unknown>; paths: string[]; draft: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null);
  const [resourceBase, setResourceBase] = useState<Record<string, unknown>>({});
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const userEditedRef = useRef(false);

  const valueRef = useRef(value);
  const originalRef = useRef(original);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const formatRef = useRef<() => void>(() => {});

  const isDirty = value !== original;
  const resourceSchema = getAdminResourceSchema(api);
  const identityPaths = getResourceIdentityPaths(api);
  const conditionalRequirements = getResourceConditionalRequirements(api);
  const identityValues = Object.fromEntries(
    identityPaths
      .filter((path) => resourceBase[path] !== undefined)
      .map((path) => [path, resourceBase[path]])
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    onSavingChange?.(saving);
    return () => onSavingChange?.(false);
  }, [onSavingChange, saving]);

  const loadData = useCallback((data: Record<string, unknown>) => {
    const normalizedResource = normalizeApiResource(api, data);
    const json = toJson(stripPatchReadonlyFields(normalizedResource));
    setResourceBase(normalizedResource);
    setValue(json);
    setOriginal(json);
    setError(null);
    setConflict(null);
    userEditedRef.current = false;
  }, [api]);

  const handleResetDraft = useCallback(() => {
    userEditedRef.current = false;
    setValue(original);
    setError(null);
    setSaveFeedback(null);
  }, [original]);

  const handleReloadLatest = useCallback(async () => {
    if (!api || saving) return;
    setLoading(true);
    setError(null);
    setSaveFeedback(null);
    try {
      const res = await req.get(api);
      const data = res.data?.value as Record<string, unknown> | undefined;
      if (!isRecord(data)) {
        throw new Error('Admin API returned no resource value');
      }
      loadData(data);
      setSaveFeedback({
        type: 'success',
        message: 'Reloaded latest APISIX resource state.',
        at: new Date().toLocaleTimeString(),
      });
    } catch (e) {
      setError('Reload failed: ' + getAdminApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [api, loadData, saving]);

  useEffect(() => {
    if (!active || !api) return;

    if (initialData) {
      if (userEditedRef.current && valueRef.current !== originalRef.current) {
        setSaveFeedback({
          type: 'warning',
          message: 'Latest API data arrived after editing started, so the editor was not overwritten.',
          at: new Date().toLocaleTimeString(),
        });
      } else {
        loadData(initialData);
      }
    }

    if (!autoFetch) return;

    if (!initialData) {
      setLoading(true);
    }
    setError(null);
    setSaveFeedback(null);
    let cancelled = false;

    req
      .get(api)
      .then((res) => {
        if (cancelled) return;
        const data = res.data?.value as Record<string, unknown> | undefined;
        if (!data) return;

        if (userEditedRef.current && valueRef.current !== originalRef.current) {
          setSaveFeedback({
            type: 'warning',
            message: 'Latest API data arrived after editing started, so the editor was not overwritten.',
            at: new Date().toLocaleTimeString(),
          });
          return;
        }

        loadData(data);
      })
      .catch(() => {
        if (cancelled) return;
        if (!initialData) setError('Failed to load resource');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active, api, autoFetch, initialData, loadData]);

  const handleSave = useCallback(async () => {
    if (saving || loading || disabled) return;
    setError(null);
    setSaveFeedback(null);

    let parsed: unknown;
    let previous: unknown;
    try {
      parsed = JSON.parse(value);
      previous = JSON.parse(original || '{}');
    } catch (e) {
      setError('Invalid JSON: ' + String(e));
      return;
    }

    if (!isRecord(parsed)) {
      setError('Invalid payload: top-level JSON must be an object');
      return;
    }

    if (!isRecord(previous)) {
      setError('Cannot compare against the original resource. Reload and try again.');
      return;
    }

    const readonlyKeys = getChangedTopLevelReadonlyKeys(parsed, previous);
    if (readonlyKeys.length > 0) {
      setError(
        `Read-only fields are managed by the Admin API path and must not be included: ${readonlyKeys.join(', ')}`
      );
      return;
    }

    const editableParsed = stripPatchReadonlyFields(parsed);
    const validationCandidate = restorePatchReadonlyFields(editableParsed, resourceBase);

    // Validate editable JSON together with the read-only metadata hidden from the editor.
    const schema = getAdminResourceSchema(api);
    if (schema) {
      const result = schema.safeParse(validationCandidate);
      if (!result.success) {
        const errorDetails = result.error.errors
          .map((err: ZodIssue) => `  ${err.path.join('.') || 'Root'}: ${err.message}`)
          .join('\n');
        setError(`Schema validation failed:\n${errorDetails}`);
        return;
      }
    }

    const payload = buildPatchPayload(editableParsed, previous);

    if (Object.keys(payload).length === 0) {
      setValue(original);
      userEditedRef.current = false;
      const noChangesMessage = 'No changed fields to save.';
      setSaveFeedback({
        type: 'warning',
        message: noChangesMessage,
        at: new Date().toLocaleTimeString(),
      });
      message.info(noChangesMessage);
      return;
    }

    setSaving(true);
    setReview(null);
    let patchAccepted = false;
    const consumerUsername = api.match(/^\/consumers\/([^/]+)$/)?.[1];
    try {
      const latestResponse = await req.get(api);
      const latest = latestResponse.data?.value;
      if (!isRecord(latest)) {
        throw new Error('Could not check the latest resource. No changes were sent.');
      }
      const normalizedLatest = normalizeApiResource(api, latest);
      const paths = getPatchConflictPaths(payload, previous, stripPatchReadonlyFields(normalizedLatest));
      if (paths.length > 0) {
        setConflict({ latest: normalizedLatest, paths, draft: toJson(editableParsed) });
        return;
      }
      try {
        if (consumerUsername) {
          if (normalizedLatest.username !== decodeURIComponent(consumerUsername)) throw new Error('The latest Consumer has an unexpected username. No changes were sent.');
          const merged = applyBulkPatch(normalizedLatest, payload);
          const checked = schema?.safeParse(merged);
          if (checked && !checked.success) throw new Error('The latest Consumer no longer matches the schema. Reload before saving.');
          await req.put(api, stripSystemReadonlyFields(merged));
        } else await req.patch(api, payload);
        patchAccepted = true;
      } catch (e) {
        const status = (e as { response?: { status?: number } }).response?.status;
        if (status === 405 || status === 501) {
          const unsupportedMsg = `Direct Admin API ${consumerUsername ? 'PUT' : 'PATCH'} is not supported for this resource.`;
          setError(unsupportedMsg);
          setSaveFeedback({
            type: 'error',
            message: unsupportedMsg,
            at: new Date().toLocaleTimeString(),
          });
          return;
        }
        throw e;
      }

      const verifiedResource = await verifySavedResource(api, payload);
      recordResourceChange(api, normalizedLatest, applyBulkPatch(normalizedLatest, payload));
      loadData(verifiedResource);
      const successMsg = 'Saved and verified changed fields in APISIX';
      showNotification({ message: successMsg, type: 'success' });
      setSaveFeedback({
        type: 'success',
        message: successMsg,
        at: new Date().toLocaleTimeString(),
      });
      try {
        await queryClient.invalidateQueries();
        await onSaved?.();
      } catch {
        showNotification({
          message: 'The save was verified, but the surrounding page could not refresh.',
          type: 'warning',
        });
      }
    } catch (e) {
      const failureMsg = patchAccepted
        ? 'APISIX accepted the update, but the saved state could not be verified. Reload before making further changes: '
          + getAdminApiErrorMessage(e)
        : 'Save failed: ' + getAdminApiErrorMessage(e);
      setError(failureMsg);
      setSaveFeedback({ type: 'error', message: failureMsg, at: new Date().toLocaleTimeString() });
    } finally {
      setSaving(false);
    }
  }, [api, disabled, loadData, loading, onSaved, original, resourceBase, saving, value]);

  const handleReview = () => {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!isRecord(parsed)) throw new Error('Payload must be a JSON object');
      setReview({ original, modified: toJson(parsed) });
    } catch (e) {
      setError('Cannot review invalid JSON: ' + String(e));
    }
  };

  const handleFormat = useCallback(() => {
    setError(null);
    if (editorRef.current) {
      // Use Monaco's built-in formatter which preserves key ordering exactly
      editorRef.current.getAction('editor.action.formatDocument')?.run();
      message.success('JSON formatted successfully');
    } else {
      try {
        const parsed = JSON.parse(value);
        setValue(toJson(parsed));
        message.success('JSON formatted successfully');
      } catch (e) {
        setError('Format failed: invalid JSON syntax (' + String(e) + ')');
      }
    }
  }, [value]);

  valueRef.current = value;
  originalRef.current = original;
  saveRef.current = handleSave;
  formatRef.current = handleFormat;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      message.success('Copied to clipboard');
    } catch {
      message.error('Failed to copy to clipboard');
    }
  }, [value]);

  const handleEditorMount = useCallback((ed: editor.IStandaloneCodeEditor) => {
    editorRef.current = ed;
    setCodeEditor(ed);
    window.__monacoEditor__ = ed;

    // Ctrl+S / Cmd+S keybinding for Saving Changes
    ed.addCommand(2048 | 49, () => {
      if (valueRef.current !== originalRef.current) saveRef.current();
    });

    // Shift+Alt+F / Shift+Option+F keybinding for Formatting JSON
    ed.addCommand(1024 | 512 | 36, () => {
      formatRef.current();
    });
  }, []);

  useEffect(() => {
    return () => {
      editorRef.current?.dispose();
    };
  }, []);

  return (
    <div className={fillAvailable ? classes.fillAvailable : undefined}>
      {error && (
        <Alert
          type="error"
          showIcon
          message={<div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--app-font-monospace)', fontSize: 'var(--app-font-size-sm)' }}>{error}</div>}
          action={
            !disabled && (
              <Space>
                <Button size="small" onClick={handleResetDraft} disabled={!isDirty || saving}>
                  Reset draft
                </Button>
                <Button size="small" onClick={handleReloadLatest} loading={loading}>
                  Reload latest
                </Button>
              </Space>
            )
          }
          style={{ marginBottom: 12 }}
          closable
          onClose={() => setError(null)}
        />
      )}
      {saveFeedback && saveFeedback.type !== 'success' && (
        <Alert
          type={saveFeedback.type}
          showIcon
          message={saveFeedback.message}
          description={`Time: ${saveFeedback.at}`}
          style={{ marginBottom: 12 }}
          closable
          onClose={() => setSaveFeedback(null)}
        />
      )}
      {/^\/consumers\/[^/]+$/.test(api) && <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="Consumers use PUT: changed fields are merged into the latest server value before saving." />}
      {resourceSchema && value && (
        <JsonSchemaGuide
          schema={resourceSchema}
          value={value}
          title="Required fields and schema validation"
          compact
          collapsible
          validAlertType="info"
          validMessage={null}
          ignoredPaths={[...identityPaths, 'create_time', 'update_time']}
          identityPaths={identityPaths}
          identityValues={identityValues}
          conditionalRequirements={conditionalRequirements}
        />
      )}
      {!loading && <RawJsonNavigation codeEditor={codeEditor} value={value} original={original}
        schema={resourceSchema} resourceBase={resourceBase} disabled={disabled || saving} />}
      {loading ? (
        <div
          className={fillAvailable ? classes.editorArea : undefined}
          style={{ textAlign: 'center', padding: 40 }}
        >
          Loading...
        </div>
      ) : (
        <div className={fillAvailable ? classes.editorArea : undefined}>
          <JsonCodeEditor
            height={fillAvailable ? '100%' : height}
            value={value}
            onChange={(nextValue) => {
              if (disabled || saving) return;
              userEditedRef.current = true;
              setValue(nextValue ?? '');
              setSaveFeedback(null);
            }}
            onMount={handleEditorMount}
            readOnly={disabled || saving}
          />
        </div>
      )}
      {!disabled && (
        <Space
          className={fillAvailable ? classes.actionBar : undefined}
          style={{ width: '100%', justifyContent: 'space-between', marginTop: 12 }}
          wrap
        >
          <Typography.Text type={isDirty ? 'warning' : 'secondary'} aria-live="polite">
            {saving
              ? 'Saving and verifying with APISIX...'
              : isDirty
                ? 'Unsaved changes. Ctrl+S saves changed fields.'
                : saveFeedback?.type === 'success'
                  ? `Saved at ${saveFeedback.at}`
                  : 'No pending changes'}
          </Typography.Text>
          <Space wrap>
            <ResourceHistory api={api} disabled={saving || loading} onRestore={(draft, latest) => {
              setResourceBase(normalizeApiResource(api, latest)); setOriginal(draft.original); setValue(draft.value);
              userEditedRef.current = true; setError(null);
              setSaveFeedback({ type: 'warning', message: 'Previous values restored into the editor. Review and save to apply.', at: new Date().toLocaleTimeString() });
            }} />
            <ConfigurationImpact api={api} disabled={saving || loading} />
            <LocalRawDraft key={api} api={api} snapshot={{ original, value }} disabled={saving || loading || !original}
              onRestore={(draft, latest) => {
                setResourceBase(normalizeApiResource(api, latest));
                setOriginal(draft.original);
                setValue(draft.value);
                userEditedRef.current = true;
                setError(null);
                setSaveFeedback({ type: 'warning', message: 'Local draft restored. Review and save to apply it to APISIX.', at: new Date().toLocaleTimeString() });
              }} />
            <Tooltip title="Format Admin API JSON">
              <Button size="small" onClick={handleFormat} disabled={saving || loading}>Format</Button>
            </Tooltip>
            <Tooltip title="Copy Admin API JSON">
              <Button size="small" onClick={handleCopy}>Copy</Button>
            </Tooltip>
            <Button
              size="small"
              onClick={handleResetDraft}
              disabled={!isDirty || saving || loading}
            >
              Reset
            </Button>
            <Button onClick={handleReview} disabled={!isDirty || saving || loading}>
              Review changes
            </Button>
            <Button
              type="primary"
              aria-label="Save Changes"
              loading={saving}
              onClick={handleSave}
              disabled={!isDirty || loading}
            >
              Save Changes
            </Button>
          </Space>
        </Space>
      )}
      <JsonChangeReview
        open={conflict !== null}
        title="Resolve concurrent changes"
        description={`Nothing was saved. These fields changed in APISIX while you were editing: ${conflict?.paths.join(', ') ?? ''}. Compare the latest server value (left) with your draft (right). Keep editing preserves your draft; using the latest value discards it.`}
        original={conflict ? toJson(stripPatchReadonlyFields(conflict.latest)) : ''}
        modified={conflict?.draft ?? ''}
        confirmText="Use latest and discard draft"
        onCancel={() => setConflict(null)}
        onSave={() => {
          if (conflict) loadData(conflict.latest);
        }}
      />
      <JsonChangeReview
        open={review !== null}
        original={review?.original ?? ''}
        modified={review?.modified ?? ''}
        saving={saving}
        onCancel={() => setReview(null)}
        onSave={async () => {
          setReview(null);
          await handleSave();
        }}
      />
    </div>
  );
};
