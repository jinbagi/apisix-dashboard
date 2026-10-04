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
import { createFileRoute, useBlocker } from '@tanstack/react-router';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  message,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ZodTypeAny } from 'zod';

import { type HistoryOutcome, trackResourceWrite } from '@/apis/tracked-resource-write';
import { JsonCodeEditor } from '@/components/form/JsonCodeEditor';
import { JsonSchemaGuide } from '@/components/form/JsonSchemaGuide';
import { ServicePostSchema } from '@/components/form-slice/FormPartService/schema';
import { SSLPostSchema } from '@/components/form-slice/FormPartSSL/schema';
import { StreamRoutePostSchema } from '@/components/form-slice/FormPartStreamRoute/schema';
import { UpstreamPostSchema } from '@/components/form-slice/FormPartUpstream/schema';
import { ConsolePresets } from '@/components/page/ConsolePresets';
import { ConsoleVariables } from '@/components/page/ConsoleVariables';
import PageHeader from '@/components/page/PageHeader';
import { ResourceHistory } from '@/components/page/ResourceHistory';
import {
  API_CONSUMER_GROUPS,
  API_CONSUMERS,
  API_GLOBAL_RULES,
  API_PLUGIN_CONFIGS,
  API_PLUGIN_METADATA,
  API_PLUGINS,
  API_PROTOS,
  API_ROUTES,
  API_SECRETS,
  API_SERVICES,
  API_SSLS,
  API_STREAM_ROUTES,
  API_UPSTREAMS,
  SKIP_INTERCEPTOR_HEADER,
} from '@/config/constant';
import { req } from '@/config/req';
import {
  ROUTE_REQUIRED_TEMPLATE,
  SERVICE_REQUIRED_TEMPLATE,
  UPSTREAM_REQUIRED_TEMPLATE,
} from '@/config/resourceTemplates';
import { adminKeyAtom } from '@/stores/global';
import { APISIX } from '@/types/schema/apisix';
import { APISIXProtos } from '@/types/schema/apisix/protos';
import {
  isRecord,
  PATCH_READONLY_KEYS,
  sortJsonKeys,
  stripPatchReadonlyFields,
} from '@/utils/apisixEditable';
import { MAX_REQUEST_PRESETS, parseRequestPresets, presetCollection, presetIdentity, type RequestPreset } from '@/utils/consoleTemplates';
import { createRequiredJsonTemplate } from '@/utils/jsonRequiredTemplate';
import {
  formatJsonSchemaPath,
  getJsonSchemaFeedback,
} from '@/utils/jsonSchemaFeedback';
import { getResourceConditionalRequirements } from '@/utils/resourceJsonSchema';

import classes from './index.module.css';

const RESOURCE_OPTIONS = [
  { label: 'Routes', value: API_ROUTES },
  { label: 'Services', value: API_SERVICES },
  { label: 'Upstreams', value: API_UPSTREAMS },
  { label: 'Consumers', value: API_CONSUMERS },
  { label: 'Consumer Groups', value: API_CONSUMER_GROUPS },
  { label: 'SSLs', value: API_SSLS },
  { label: 'Stream Routes', value: API_STREAM_ROUTES },
  { label: 'Global Rules', value: API_GLOBAL_RULES },
  { label: 'Plugin Configs', value: API_PLUGIN_CONFIGS },
  { label: 'Plugin Metadata', value: API_PLUGIN_METADATA },
  { label: 'Plugins', value: API_PLUGINS },
  { label: 'Protos', value: API_PROTOS },
  { label: 'Secrets', value: API_SECRETS },
];

const METHODS = ['PUT', 'PATCH', 'GET', 'POST', 'DELETE'] as const;

const METHOD_COLORS: Record<string, string> = {
  GET: '#13c2c2',
  PUT: '#faad14',
  PATCH: '#52c41a',
  POST: '#1677ff',
  DELETE: '#ff4d4f',
};

const METHOD_HINTS: Record<string, string> = {
  GET: 'Read collection, resource, or subpath',
  PUT: 'Send body as full replace/update',
  PATCH: 'Send body as partial update',
  POST: 'Send body to collection or subpath',
  DELETE: 'Delete the target path',
};

const METHODS_REQUIRING_RESOURCE_PATH = new Set(['PUT', 'PATCH', 'DELETE']);

type ExistingResource = { path: string; name?: string };
type ConsoleResponse = {
  status: number;
  data: string;
  headers: string;
  time: number;
};
type RequestHistoryEntry = {
  id: string;
  method: string;
  resource: string;
  pathSuffix: string;
  queryString: string;
  body: string;
  endpoint: string;
  status: number;
  time: number;
  createdAt: number;
};
type ConsoleRequestSnapshot = {
  method: string;
  resource: string;
  pathSuffix: string;
  queryString: string;
  body: string;
  endpoint: string;
};
type LoadedBodyNotice = {
  rawBody: string;
  removedKeys: string[];
};
type RequestBodyError = {
  message: string;
  details: string[];
};

const REQUEST_HISTORY_KEY = 'api-console:session-history';
const REQUEST_PRESETS_KEY = 'api-console:session-presets';
const MAX_REQUEST_HISTORY = 25;
const CONSOLE_INTERCEPTOR_SKIPS = [
  'network',
  '400',
  '401',
  '403',
  '404',
  '409',
  '422',
  '429',
  '500',
  '502',
  '503',
  '504',
];

const readRequestHistory = (): RequestHistoryEntry[] => {
  try {
    const value = JSON.parse(sessionStorage.getItem(REQUEST_HISTORY_KEY) ?? '[]');
    return Array.isArray(value) ? value.slice(0, MAX_REQUEST_HISTORY) : [];
  } catch {
    return [];
  }
};

const readRequestPresets = (): RequestPreset[] => {
  try {
    const value = JSON.parse(sessionStorage.getItem(REQUEST_PRESETS_KEY) ?? '[]');
    return parseRequestPresets(value);
  } catch {
    return [];
  }
};

const stringifyHeaders = (headers: unknown) => {
  if (!headers) return '{}';
  const value = typeof (headers as { toJSON?: () => unknown }).toJSON === 'function'
    ? (headers as { toJSON: () => unknown }).toJSON()
    : headers;
  return stringifyResponseData(value) || '{}';
};

const AdminRouteBodySchema = APISIX.Route.omit({
  id: true,
  create_time: true,
  update_time: true,
}).refine(
  (data) =>
    (typeof data.uri === 'string' && data.uri.trim().length > 0) ||
    (Array.isArray(data.uris) &&
      data.uris.some((uri) => uri.trim().length > 0)),
  {
    message: 'At least one request URI is required (uri or uris)',
    path: ['uri'],
  }
);

const getRequestBodySchema = (
  resource: string,
  method: string,
  pathSuffix: string
): ZodTypeAny | null => {
  if (method === 'PATCH' || method === 'GET' || method === 'DELETE') return null;

  const hasResourceId = pathSuffix.length > 0;
  switch (resource) {
    case API_ROUTES:
      return AdminRouteBodySchema;
    case API_STREAM_ROUTES:
      return StreamRoutePostSchema;
    case API_SERVICES:
      return ServicePostSchema;
    case API_UPSTREAMS:
      return UpstreamPostSchema;
    case API_CONSUMERS:
      return hasResourceId
        ? APISIX.ConsumerPut.omit({ username: true })
        : APISIX.ConsumerPut;
    case API_CONSUMER_GROUPS:
      return hasResourceId
        ? APISIX.ConsumerGroupPut.omit({ id: true })
        : APISIX.ConsumerGroupPut;
    case API_SSLS:
      return SSLPostSchema;
    case API_GLOBAL_RULES:
      return hasResourceId
        ? APISIX.GlobalRulePut.omit({ id: true })
        : APISIX.GlobalRulePut;
    case API_PLUGIN_CONFIGS:
      return hasResourceId
        ? APISIX.PluginConfigPut.omit({ id: true })
        : APISIX.PluginConfigPut;
    case API_PLUGIN_METADATA:
      return APISIX.PluginMetadataPut;
    case API_PROTOS:
      return APISIXProtos.ProtoPost;
    case API_SECRETS: {
      const manager = pathSuffix.split('/')[0];
      if (manager === 'vault') {
        return APISIX.VaultSecret.omit({ id: true, manager: true });
      }
      if (manager === 'aws') {
        return APISIX.AWSSecret.omit({ id: true, manager: true });
      }
      if (manager === 'gcp') {
        return APISIX.GCPSecret.omit({ id: true, manager: true });
      }
      return null;
    }
    default:
      return null;
  }
};

const getRequiredRequestTemplate = (
  resource: string,
  method: string,
  pathSuffix: string
) => {
  const schema = getRequestBodySchema(resource, method, pathSuffix);
  if (!schema) return {};

  if (resource === API_ROUTES) {
    return createRequiredJsonTemplate(schema, ROUTE_REQUIRED_TEMPLATE);
  }
  if (resource === API_SERVICES) {
    return createRequiredJsonTemplate(schema, SERVICE_REQUIRED_TEMPLATE);
  }
  if (resource === API_UPSTREAMS) {
    return createRequiredJsonTemplate(schema, UPSTREAM_REQUIRED_TEMPLATE);
  }
  return createRequiredJsonTemplate(schema);
};

const stringifyRequiredRequestTemplate = (
  resource: string,
  method: string,
  pathSuffix: string
) =>
  JSON.stringify(
    getRequiredRequestTemplate(resource, method, pathSuffix),
    null,
    2
  );

const getResourcePath = (value: Record<string, unknown>, resource: string) => {
  if (resource === API_SECRETS) {
    const manager = value.manager ? String(value.manager) : '';
    const id = value.id ? String(value.id) : '';
    return manager && id ? `${manager}/${id}` : id;
  }

  return String(value.id || value.username || '');
};

const stringifyResponseData = (data: unknown) => {
  if (data === undefined) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
};

const normalizeDraftBody = (body: string) => {
  try { return JSON.stringify(sortJsonKeys(JSON.parse(body))); }
  catch { return body; }
};

const draftFingerprint = (request: ConsoleRequestSnapshot) => JSON.stringify([
  request.method, request.resource, request.pathSuffix, request.queryString,
  request.method === 'GET' || request.method === 'DELETE' ? '' : normalizeDraftBody(request.body),
]);

const getEditableLoadedBody = (value: unknown) => {
  const sortedRaw = sortJsonKeys(value);
  const rawBody = JSON.stringify(sortedRaw, null, 2);

  if (!isRecord(value)) {
    return {
      body: rawBody,
      rawBody,
      removedKeys: [],
    };
  }

  const editableValue = stripPatchReadonlyFields(value);
  const removedKeys = PATCH_READONLY_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(value, key)
  );

  return {
    body: JSON.stringify(sortJsonKeys(editableValue), null, 2),
    rawBody,
    removedKeys,
  };
};

const getErrorResponse = (error: unknown, elapsed: number): ConsoleResponse & { error: string } => {
  const response = (error as {
    response?: { status?: number; data?: unknown; headers?: unknown };
  }).response;
  if (response) {
    return {
      status: response.status ?? 0,
      data: stringifyResponseData(response.data),
      headers: stringifyHeaders(response.headers),
      error: typeof response.data === 'string'
        ? response.data
        : error instanceof Error ? error.message : String(error),
      time: elapsed,
    };
  }

  return {
    status: 0,
    data: '',
    headers: '{}',
    error: error instanceof Error ? error.message : String(error),
    time: elapsed,
  };
};

function useExistingResources(resource: string) {
  const [items, setItems] = useState<ExistingResource[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    req
      .get(resource, {
        params: { page: 1, page_size: 100 },
        headers: { [SKIP_INTERCEPTOR_HEADER]: CONSOLE_INTERCEPTOR_SKIPS },
      })
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.list;
        if (!Array.isArray(list)) { setItems([]); return; }
        setItems(
          list
            .map((item: { value: Record<string, unknown> }) => ({
              path: getResourcePath(item.value, resource),
              name: String(item.value.name || item.value.desc || ''),
            }))
            .filter((item) => item.path)
        );
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [resource]);

  return { items, loading };
}

function RawApiPage() {
  const adminKey = useAtomValue(adminKeyAtom);
  const [resource, setResource] = useState(API_ROUTES);
  const [method, setMethod] = useState<string>('PUT');
  const [pathSuffix, setPathSuffix] = useState('');
  const [queryString, setQueryString] = useState('');
  const [body, setBody] = useState(() =>
    stringifyRequiredRequestTemplate(API_ROUTES, 'PUT', '')
  );
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [response, setResponse] = useState<ConsoleResponse | null>(null);
  const [resourceHistoryOutcome, setResourceHistoryOutcome] = useState<HistoryOutcome | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [responseView, setResponseView] = useState<'Body' | 'Headers'>('Body');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetGroup, setPresetGroup] = useState('');
  const [loadedBodyNotice, setLoadedBodyNotice] =
    useState<LoadedBodyNotice | null>(null);
  const [requestBodyError, setRequestBodyError] =
    useState<RequestBodyError | null>(null);
  const [requestHistory, setRequestHistory] = useState<RequestHistoryEntry[]>(
    readRequestHistory
  );
  const [requestPresets, setRequestPresets] = useState<RequestPreset[]>(
    readRequestPresets
  );
  const replacingPreset = requestPresets.some((item) => presetIdentity(item.name, item.collection) === presetIdentity(presetName, presetCollection(presetGroup)));
  const [lastRequest, setLastRequest] = useState<ConsoleRequestSnapshot | null>(null);
  const [baseline, setBaseline] = useState<ConsoleRequestSnapshot>(() => ({
    method: 'PUT', resource: API_ROUTES, pathSuffix: '', queryString: '',
    body: stringifyRequiredRequestTemplate(API_ROUTES, 'PUT', ''), endpoint: API_ROUTES,
  }));
  const [pendingReplacement, setPendingReplacement] = useState<(() => void) | null>(null);

  const { items: existingResources, loading: resourcesLoading } = useExistingResources(resource);

  const needsBody = method !== 'GET' && method !== 'DELETE';
  const normalizedPathSuffix = pathSuffix.trim().replace(/^\/+|\/+$/g, '');
  const normalizedQueryString = queryString.trim().replace(/^[?&]+/, '');
  const endpoint = normalizedPathSuffix ? `${resource}/${normalizedPathSuffix}` : resource;
  const requestUrl = normalizedQueryString
    ? `${endpoint}?${normalizedQueryString}`
    : endpoint;
  const currentDraft = useMemo<ConsoleRequestSnapshot>(() => ({
    method, resource, pathSuffix: normalizedPathSuffix, queryString: normalizedQueryString,
    body, endpoint: requestUrl,
  }), [body, method, normalizedPathSuffix, normalizedQueryString, requestUrl, resource]);
  const hasUnsentChanges = draftFingerprint(currentDraft) !== draftFingerprint(baseline);
  const hasBodyChanges = needsBody && normalizeDraftBody(body) !== normalizeDraftBody(baseline.body);
  const busy = loading || loadingExisting;
  const navigationBlocker = useBlocker({
    shouldBlockFn: ({ current, next }) => current.pathname !== next.pathname && (hasUnsentChanges || busy),
    enableBeforeUnload: hasUnsentChanges || busy,
    withResolver: true,
  });
  const requestReplacement = useCallback((action: () => void, protect = hasUnsentChanges) => {
    if (busy) return;
    if (protect) setPendingReplacement(() => action);
    else action();
  }, [busy, hasUnsentChanges]);
  const requestBodySchema = useMemo(
    () => getRequestBodySchema(resource, method, normalizedPathSuffix),
    [method, normalizedPathSuffix, resource]
  );

  const handleLoadExisting = useCallback(async () => {
    if (!normalizedPathSuffix) { message.warning('Enter a path suffix to load'); return; }
    setLoadingExisting(true);
    setResponse(null);
    setResponseError(null);
    setResourceHistoryOutcome(null);
    const start = performance.now();
    try {
      const res = await req.get(requestUrl, {
        headers: { [SKIP_INTERCEPTOR_HEADER]: CONSOLE_INTERCEPTOR_SKIPS },
      });
      const value = res.data?.value ?? res.data;
      const editableBody = getEditableLoadedBody(value);
      setBody(editableBody.body);
      setBaseline({ ...currentDraft, body: editableBody.body });
      setRequestBodyError(null);
      setLoadedBodyNotice(
        editableBody.removedKeys.length > 0
          ? {
              rawBody: editableBody.rawBody,
              removedKeys: editableBody.removedKeys,
            }
          : null
      );
      setResponse({
        status: res.status,
        data: stringifyResponseData(res.data),
        headers: stringifyHeaders(res.headers),
        time: Math.round(performance.now() - start),
      });
      message.success(`Loaded ${normalizedPathSuffix}`);
    } catch (e) {
      const failure = getErrorResponse(e, Math.round(performance.now() - start));
      setResponseError(failure.error);
      setResponse(failure);
      message.error(`Failed to load ${normalizedPathSuffix}`);
    } finally {
      setLoadingExisting(false);
    }
  }, [currentDraft, normalizedPathSuffix, requestUrl]);

  const addHistoryEntry = useCallback((
    status: number,
    elapsed: number,
    requestSnapshot: ConsoleRequestSnapshot
  ) => {
    const entry: RequestHistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...requestSnapshot,
      status,
      time: elapsed,
      createdAt: Date.now(),
    };
    setRequestHistory((current) => {
      const next = [entry, ...current].slice(0, MAX_REQUEST_HISTORY);
      try { sessionStorage.setItem(REQUEST_HISTORY_KEY, JSON.stringify(next)); }
      catch { /* Keep history in memory when session storage is unavailable. */ }
      return next;
    });
  }, []);

  const restoreRequest = useCallback((requestSnapshot: ConsoleRequestSnapshot) => {
    requestReplacement(() => {
      setMethod(requestSnapshot.method);
      setResource(requestSnapshot.resource);
      setPathSuffix(requestSnapshot.pathSuffix);
      setQueryString(requestSnapshot.queryString);
      setBody(requestSnapshot.body);
      setBaseline(requestSnapshot);
      setLoadedBodyNotice(null);
      setRequestBodyError(null);
      setResponse(null);
      setResponseError(null);
      setResourceHistoryOutcome(null);
      setResponseView('Body');
      message.success('Request restored. Review it before sending.');
    }, hasUnsentChanges && draftFingerprint(requestSnapshot) !== draftFingerprint(currentDraft));
  }, [currentDraft, hasUnsentChanges, requestReplacement]);

  const doExecute = useCallback(async (requestOverride?: ConsoleRequestSnapshot) => {
    const activeMethod = requestOverride?.method ?? method;
    const activeResource = requestOverride?.resource ?? resource;
    const activePathSuffix = requestOverride?.pathSuffix ?? normalizedPathSuffix;
    const activeQueryString = requestOverride?.queryString ?? normalizedQueryString;
    const activeNeedsBody = activeMethod !== 'GET' && activeMethod !== 'DELETE';
    const activeBody = requestOverride?.body ?? (activeNeedsBody ? body : '');
    const activeEndpoint =
      requestOverride?.endpoint
      ?? (activePathSuffix ? `${activeResource}/${activePathSuffix}` : activeResource);
    const activeRequestUrl = requestOverride
      ? requestOverride.endpoint
      : activeQueryString
      ? `${activeEndpoint}?${activeQueryString}`
      : activeEndpoint;
    const activeRequestBodySchema = getRequestBodySchema(
      activeResource,
      activeMethod,
      activePathSuffix
    );
    const requestSnapshot: ConsoleRequestSnapshot = {
      method: activeMethod,
      resource: activeResource,
      pathSuffix: activePathSuffix,
      queryString: activeQueryString,
      body: activeNeedsBody ? activeBody : '',
      endpoint: activeRequestUrl,
    };

    if (
      METHODS_REQUIRING_RESOURCE_PATH.has(activeMethod) &&
      !activePathSuffix
    ) {
      message.error(`${activeMethod} requires a resource path suffix.`);
      return;
    }

    let parsedBody: unknown = undefined;
    if (activeNeedsBody) {
      try {
        parsedBody = JSON.parse(activeBody);
      } catch (e) {
        setRequestBodyError({
          message: 'Fix Request JSON before sending.',
          details: [e instanceof Error ? e.message : String(e)],
        });
        message.error('Fix Request JSON before sending.');
        return;
      }
      if (activeRequestBodySchema) {
        const feedback = getJsonSchemaFeedback(activeRequestBodySchema, activeBody);
        if (feedback.syntaxError || feedback.issues.length > 0) {
          setRequestBodyError({
            message: 'Resolve APISIX schema issues before sending.',
            details: feedback.syntaxError
              ? [feedback.syntaxError]
              : feedback.issues.map(
                  (issue) => `${formatJsonSchemaPath(issue)}: ${issue.message}`
                ),
          });
          message.error('Resolve the APISIX schema issues before executing this request.');
          return;
        }
      }
    }
    setLoading(true);
    setRequestBodyError(null);
    setLastRequest(requestSnapshot);
    setResponse(null);
    setResponseError(null);
    setResourceHistoryOutcome(null);
    const start = performance.now();
    try {
      const execute = async () => {
        const requestStart = performance.now();
        const res = await req.request({
          method: activeMethod.toLowerCase(),
          url: activeRequestUrl,
          data: parsedBody,
          headers: { [SKIP_INTERCEPTOR_HEADER]: CONSOLE_INTERCEPTOR_SKIPS },
        });
        const elapsed = Math.round(performance.now() - requestStart);
        setResponse({ status: res.status, data: stringifyResponseData(res.data),
          headers: stringifyHeaders(res.headers), time: elapsed });
        addHistoryEntry(res.status, elapsed, requestSnapshot);
        setBaseline(requestSnapshot);
        return res;
      };
      const outcome = activeMethod === 'GET' ? null : await trackResourceWrite({
        source: 'console', method: activeMethod, api: activeRequestUrl,
        body: parsedBody, allowUntracked: true,
      }, execute);
      if (!outcome) await execute();
      setResourceHistoryOutcome(outcome?.history ?? null);
    } catch (e) {
      const failure = getErrorResponse(e, Math.round(performance.now() - start));
      setResponseError(failure.error);
      setResponse(failure);
      addHistoryEntry(failure.status, failure.time, requestSnapshot);
    } finally {
      setLoading(false);
    }
  }, [
    addHistoryEntry,
    body,
    method,
    normalizedPathSuffix,
    normalizedQueryString,
    resource,
  ]);

  const executeWithConfirmation = useCallback((
    requestSnapshot: ConsoleRequestSnapshot,
    action: () => void | Promise<void>
  ) => {
    if (requestSnapshot.method === 'DELETE') {
      Modal.confirm({
        centered: true, okButtonProps: { danger: true },
        title: `DELETE ${requestSnapshot.endpoint}`,
        content: 'This will permanently delete the resource.',
        okText: 'Delete', onOk: action,
      });
    } else if (requestSnapshot.method === 'PUT') {
      Modal.confirm({
        centered: true, title: `PUT ${requestSnapshot.endpoint}`,
        content: 'PUT replaces the entire resource. Omitted fields will be removed.',
        okText: 'Execute', onOk: action,
      });
    } else {
      action();
    }
  }, []);

  const handleExecute = useCallback(() => {
    const requestSnapshot: ConsoleRequestSnapshot = {
      method,
      resource,
      pathSuffix: normalizedPathSuffix,
      queryString: normalizedQueryString,
      body: needsBody ? body : '',
      endpoint: requestUrl,
    };
    executeWithConfirmation(requestSnapshot, () => doExecute(requestSnapshot));
  }, [
    body,
    doExecute,
    executeWithConfirmation,
    method,
    needsBody,
    normalizedPathSuffix,
    normalizedQueryString,
    requestUrl,
    resource,
  ]);

  const retryLastRequest = useCallback(() => {
    if (!lastRequest) return;
    executeWithConfirmation(lastRequest, () => doExecute(lastRequest));
  }, [doExecute, executeWithConfirmation, lastRequest]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (!loading && !loadingExisting && !pendingReplacement && !variablesOpen && !presetsOpen && !savePresetOpen && navigationBlocker.status !== 'blocked') handleExecute();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [handleExecute, loading, loadingExisting, navigationBlocker.status, pendingReplacement, variablesOpen, presetsOpen, savePresetOpen]);

  const formatRequestBody = useCallback(() => {
    try {
      setBody(JSON.stringify(JSON.parse(body), null, 2));
      setRequestBodyError(null);
      message.success('Request JSON formatted');
    } catch (error) {
      setRequestBodyError({
        message: 'Fix Request JSON before formatting.',
        details: [error instanceof Error ? error.message : String(error)],
      });
      message.error(`Invalid JSON: ${String(error)}`);
    }
  }, [body]);

  const resetRequestBodyTemplate = useCallback(() => {
    requestReplacement(() => {
      const template = stringifyRequiredRequestTemplate(resource, method, normalizedPathSuffix);
      setBody(template);
      setBaseline((current) => ({ ...current, body: template }));
      setLoadedBodyNotice(null);
      setRequestBodyError(null);
      message.success('Request JSON reset to template');
    }, hasBodyChanges);
  }, [hasBodyChanges, method, normalizedPathSuffix, requestReplacement, resource]);

  const restoreHistoryEntry = useCallback((entry: RequestHistoryEntry) => {
    restoreRequest(entry);
    setHistoryOpen(false);
  }, [restoreRequest]);

  const clearHistory = useCallback(() => {
    sessionStorage.removeItem(REQUEST_HISTORY_KEY);
    setRequestHistory([]);
  }, []);

  const savePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) {
      message.warning('Enter a preset name');
      return;
    }
    const enteredCollection = presetCollection(presetGroup);
    const collection = requestPresets.find((item) => item.collection.toLowerCase() === enteredCollection.toLowerCase())?.collection ?? enteredCollection;
    const remaining = requestPresets.filter((item) => presetIdentity(item.name, item.collection) !== presetIdentity(name, collection));
    if (remaining.length >= MAX_REQUEST_PRESETS) { message.error('The 20-preset limit is reached. Delete a preset or replace one with the same name and collection.'); return; }
    const preset: RequestPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      collection,
      method,
      resource,
      pathSuffix: normalizedPathSuffix,
      queryString: normalizedQueryString,
      body: needsBody ? body : '',
      endpoint: requestUrl,
      createdAt: Date.now(),
    };
    try {
      const next = [
        preset,
        ...remaining,
      ].slice(0, MAX_REQUEST_PRESETS);
      sessionStorage.setItem(REQUEST_PRESETS_KEY, JSON.stringify(next));
      setRequestPresets(next);
      setBaseline(currentDraft);
    } catch {
      message.error('Could not save the preset. Your request draft is still available.');
      return;
    }
    setPresetName('');
    setSavePresetOpen(false);
    message.success(`Saved session preset "${name}"`);
  }, [
    body,
    currentDraft,
    method,
    needsBody,
    normalizedPathSuffix,
    normalizedQueryString,
    presetName,
    presetGroup,
    requestUrl,
    requestPresets,
    resource,
  ]);

  const restorePreset = useCallback((preset: RequestPreset) => {
    restoreRequest(preset);
    setPresetsOpen(false);
  }, [restoreRequest]);

  const updatePresets = useCallback((next: RequestPreset[]) => {
    try { sessionStorage.setItem(REQUEST_PRESETS_KEY, JSON.stringify(next)); setRequestPresets(next); return true; }
    catch { message.error('Could not save preset changes. The existing list is unchanged.'); return false; }
  }, []);

  const handleCopyCurl = useCallback(async () => {
    if (!adminKey?.trim()) { message.warning('Admin Key required'); return; }
    const masked = adminKey.length > 4
      ? adminKey.slice(0, 2) + '*'.repeat(adminKey.length - 4) + adminKey.slice(-2)
      : '****';
    const baseUrl = `${window.location.origin}/apisix/admin`;
    const lines = [`curl -i -X ${method} '${baseUrl}${requestUrl}'`, `  -H 'X-API-KEY: ${masked}'`];
    if (needsBody && body.trim()) {
      lines.push("  -H 'Content-Type: application/json'");
      lines.push(`  -d '${body.replace(/'/g, "'\\''").replace(/\n\s*/g, ' ').trim()}'`);
    }
    try {
      await navigator.clipboard.writeText(lines.join(' \\\n'));
      message.success('Copied as curl (Admin Key masked - replace the masked value with your key)');
    } catch { message.error('Failed to copy'); }
  }, [method, requestUrl, body, needsBody, adminKey]);

  const restoreLoadedRawBody = useCallback(() => {
    if (!loadedBodyNotice) return;
    requestReplacement(() => {
      setBody(loadedBodyNotice.rawBody);
      setBaseline((current) => ({ ...current, body: loadedBodyNotice.rawBody }));
      setLoadedBodyNotice(null);
      message.success('Restored raw response body');
    }, hasBodyChanges);
  }, [hasBodyChanges, loadedBodyNotice, requestReplacement]);

  const statusColor = response ? (response.status < 300 ? 'success' : response.status < 400 ? 'warning' : 'error') : undefined;

  return (
    <div className={classes.page}>
      <PageHeader
        title="API Console"
        desc="Build and inspect direct requests to the APISIX Admin API"
        tag={{ label: 'Advanced', color: 'gold' }}
      />

      <div className={classes.advisory}>
        <div>
          <Typography.Text strong>Direct Admin API access</Typography.Text>
          <Typography.Paragraph type="secondary">
            Requests are sent exactly as configured. Use Admin API JSON editors
            when you want guided validation and safer payload handling.
          </Typography.Paragraph>
        </div>
        <Tag color="warning">Use with care</Tag>
      </div>

      <Card
        className={classes.requestCard}
        title={
          <div className={classes.cardTitle}>
            <span>Request builder</span>
            <Typography.Text type={hasUnsentChanges ? 'warning' : 'secondary'} aria-live="polite">
              {busy ? 'Request in progress' : hasUnsentChanges ? 'Unsent changes' : 'No unsent changes'}
            </Typography.Text>
          </div>
        }
        extra={
          <Space size={6} wrap>
            <ConsoleVariables template={currentDraft} disabled={busy} onOpenChange={setVariablesOpen} onResolved={(value) => {
              setPathSuffix(value.pathSuffix); setQueryString(value.queryString); setBody(value.body);
              setLoadedBodyNotice(null); setRequestBodyError(null); setResponse(null); setResponseError(null);
              setResourceHistoryOutcome(null);
              message.success('Resolved draft ready. Review and send when ready.');
            }} />
            <Button size="small" type="text" disabled={busy} onClick={() => setSavePresetOpen(true)}>
              Save preset
            </Button>
            <Button size="small" onClick={() => setPresetsOpen(true)}>
              Presets{requestPresets.length ? ` (${requestPresets.length})` : ''}
            </Button>
            <Button size="small" onClick={() => setHistoryOpen(true)}>
              History{requestHistory.length ? ` (${requestHistory.length})` : ''}
            </Button>
          </Space>
        }
      >
        <div className={classes.requestFields}>
          <label className={classes.field}>
            <span className={classes.fieldLabel}>Method</span>
            <Select
              value={method}
              virtual={false}
              disabled={busy}
              onChange={(value) => requestReplacement(() => {
                setMethod(value);
                setLoadedBodyNotice(null);
                setRequestBodyError(null);
                setBody(
                  stringifyRequiredRequestTemplate(
                    resource,
                    value,
                    normalizedPathSuffix
                  )
                );
                setBaseline((current) => ({ ...current, method: value,
                  body: stringifyRequiredRequestTemplate(resource, value, normalizedPathSuffix) }));
              }, hasBodyChanges)}
              className={classes.methodSelect}
              labelRender={({ value }) => (
                <span style={{ color: METHOD_COLORS[value as string], fontWeight: 'var(--app-font-weight-heading)' }}>
                  {value as string}
                </span>
              )}
              options={METHODS.map((m) => ({ value: m, label: m }))}
            />
          </label>

          <label className={classes.field}>
            <span className={classes.fieldLabel}>Resource</span>
            <Select
              value={resource}
              virtual={false}
              disabled={busy}
              onChange={(v) => requestReplacement(() => {
                setResource(v);
                setLoadedBodyNotice(null);
                setRequestBodyError(null);
                setBody(stringifyRequiredRequestTemplate(v, method, ''));
                setPathSuffix('');
                setQueryString('');
                setResponse(null);
                setResponseError(null);
                setResourceHistoryOutcome(null);
                setBaseline({ method, resource: v, pathSuffix: '', queryString: '',
                  body: stringifyRequiredRequestTemplate(v, method, ''), endpoint: v });
              })}
              options={RESOURCE_OPTIONS}
              className={classes.resourceSelect}
              showSearch
              optionFilterProp="label"
            />
          </label>

          <label className={`${classes.field} ${classes.pathField}`}>
            <span className={classes.fieldLabel}>Path suffix</span>
            <div className={classes.pathInput}>
              <span aria-hidden="true">/</span>
              <AutoComplete
                value={pathSuffix}
                disabled={busy}
                onChange={(value) => {
                  setPathSuffix(value);
                  setLoadedBodyNotice(null);
                  setRequestBodyError(null);
                }}
                options={existingResources.map((r) => ({
                  value: r.path,
                  label: (
                    <span>
                      <Typography.Text code className={classes.optionPath}>{r.path}</Typography.Text>
                      {r.name && (
                        <Typography.Text type="secondary" className={classes.optionName}>
                          {r.name}
                        </Typography.Text>
                      )}
                    </span>
                  ),
                }))}
                placeholder="Optional ID or nested path"
                className={classes.pathAutoComplete}
                filterOption={(input, option) => !!option?.value?.toString().toLowerCase().includes(input.toLowerCase())}
                notFoundContent={resourcesLoading ? <Spin size="small" /> : null}
              />
            </div>
          </label>

          <label className={`${classes.field} ${classes.queryField}`}>
            <span className={classes.fieldLabel}>Query parameters</span>
            <div className={classes.pathInput}>
              <span aria-hidden="true">?</span>
              <Input
                value={queryString}
                disabled={busy}
                onChange={(event) => setQueryString(event.target.value)}
                placeholder="page=1&page_size=50"
                className={classes.queryInput}
              />
            </div>
          </label>
        </div>

        <div className={classes.requestSummary}>
          <div className={classes.endpointSummary}>
            <Tag color={METHOD_COLORS[method]} className={classes.methodTag}>{method}</Tag>
            <Typography.Text code className={classes.endpoint}>
              /apisix/admin{requestUrl}
            </Typography.Text>
            <Typography.Text type="secondary" className={classes.methodHint}>
              {METHOD_HINTS[method]}
            </Typography.Text>
          </div>

          <div className={classes.requestActions}>
            <Button size="small" type="text" onClick={handleCopyCurl}>
              Copy as curl
            </Button>
            <Button
              loading={loadingExisting}
              disabled={!normalizedPathSuffix || loading}
              onClick={() => requestReplacement(() => { void handleLoadExisting(); }, hasBodyChanges)}
            >
              Load resource
            </Button>
            <Button
              type="primary"
              loading={loading}
              disabled={
                loadingExisting || (METHODS_REQUIRING_RESOURCE_PATH.has(method) &&
                !normalizedPathSuffix)
              }
              onClick={handleExecute}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              title="Send request (Ctrl/Cmd + Enter)"
              className={classes.executeButton}
              style={{ background: METHOD_COLORS[method] }}
            >
              Send {method}
              <span className={classes.shortcut}>Ctrl/Cmd + Enter</span>
            </Button>
          </div>
        </div>
      </Card>

      <div className={`${classes.workspace} ${needsBody ? classes.splitWorkspace : ''}`}>
        {needsBody && (
          <Card
            className={classes.workspaceCard}
            title={
              <div className={classes.panelTitle}>
                <span>Request JSON</span>
              </div>
            }
            extra={
              <Button size="small" type="text" disabled={busy} onClick={formatRequestBody}>
                Format Request JSON
              </Button>
            }
            styles={{ body: { flex: 1, padding: 0, overflow: 'hidden' } }}
          >
            <div className={classes.editorStack}>
              <div className={classes.schemaGuide}>
                {requestBodySchema ? (
                  <JsonSchemaGuide
                    schema={requestBodySchema}
                    value={body}
                    title={`${method} request schema`}
                    compact
                    conditionalRequirements={getResourceConditionalRequirements(resource)}
                  />
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    title={
                      method === 'PATCH'
                        ? 'PATCH accepts a partial payload; APISIX validates changed fields.'
                        : 'No dashboard schema is available for this endpoint.'
                    }
                    style={{ padding: '8px 12px', fontSize: 'var(--app-font-size-sm)' }}
                  />
                )}
                {loadedBodyNotice && (
                  <Alert
                    type="info"
                    showIcon
                    title="Loaded as editable request body"
                    description={`Removed read-only fields: ${loadedBodyNotice.removedKeys.join(', ')}.`}
                    action={
                      <Button size="small" onClick={restoreLoadedRawBody}>
                        Use raw response
                      </Button>
                    }
                    className={classes.loadedBodyAlert}
                  />
                )}
                {requestBodyError && (
                  <Alert
                    type="error"
                    showIcon
                    title={requestBodyError.message}
                    description={
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {requestBodyError.details.slice(0, 5).map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                        {requestBodyError.details.length > 5 && (
                          <li>{requestBodyError.details.length - 5} more issue(s)</li>
                        )}
                      </ul>
                    }
                    action={
                      <Space wrap>
                        <Button size="small" onClick={formatRequestBody}>
                          Format Request JSON
                        </Button>
                        <Button size="small" onClick={resetRequestBodyTemplate}>
                          Reset to template
                        </Button>
                      </Space>
                    }
                    className={classes.requestBodyError}
                  />
                )}
              </div>
              <div className={classes.editor}>
                <JsonCodeEditor
                  height="100%"
                  value={body}
                  readOnly={busy}
                  onChange={(nextValue) => {
                    setBody(nextValue ?? '');
                    setLoadedBodyNotice(null);
                    setRequestBodyError(null);
                  }}
                  variant="flush"
                />
              </div>
            </div>
          </Card>
        )}

        <Card
          className={classes.workspaceCard}
          title={
            <div className={classes.responseTitle}>
              <span>{responseView === 'Headers' ? 'Response Headers' : 'Response JSON'}</span>
              {response && statusColor && (
                <Tag color={statusColor}>{response.status || 'Error'}</Tag>
              )}
              {response && (
                <Typography.Text type="secondary">{response.time} ms</Typography.Text>
              )}
              {response && (
                <Segmented
                  size="small"
                  value={responseView}
                  onChange={(value) => setResponseView(value as 'Body' | 'Headers')}
                  options={['Body', 'Headers']}
                />
              )}
            </div>
          }
        extra={response && (
            <Space size={4}>
              {lastRequest && (responseError || response.status >= 400) && (
                <>
                  <Button size="small" type="text" onClick={() => restoreRequest(lastRequest)}>
                    Restore request
                  </Button>
                  <Button size="small" type="text" onClick={retryLastRequest}>
                    Retry
                  </Button>
                </>
              )}
              <Button size="small" type="text" onClick={() => {
                setResponse(null);
                setResponseError(null);
                setResourceHistoryOutcome(null);
                setResponseView('Body');
              }}>
                Clear
              </Button>
              <Button size="small" type="text" onClick={async () => {
                const value = responseView === 'Body' ? response.data : response.headers;
                try { await navigator.clipboard.writeText(value); message.success('Copied'); }
                catch { message.error('Failed'); }
              }}>Copy {responseView.toLowerCase()}</Button>
            </Space>
          )}
          styles={{ body: { flex: 1, minHeight: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}
        >
          <Typography.Paragraph type="secondary" style={{ margin: 12 }}>
            Change history verifies exact resource writes with fresh reads. Queries and arbitrary subpaths are excluded; the Console can still execute them.
          </Typography.Paragraph>
          <div style={{ margin: 12 }}><ResourceHistory disabled={loading} /></div>
          {loading && response && lastRequest?.method !== 'GET' && <Alert style={{ margin: 12 }} showIcon type="info"
            message="Request accepted. Verifying read-back for resource history…" />}
          {resourceHistoryOutcome && <Alert style={{ margin: 12 }} showIcon
            type={['recorded', 'unchanged'].includes(resourceHistoryOutcome.status) ? 'success' : resourceHistoryOutcome.status === 'unverified' ? 'warning' : 'info'}
            message={resourceHistoryOutcome.message} />}
          {responseError && response?.data && (
            <Alert
              type="error"
              showIcon
              title="Request failed"
              description={responseError}
              className={classes.responseAlert}
            />
          )}
          {responseError && !response?.data && (
            <div className={classes.responseError}>
              <Typography.Text type="danger">{responseError}</Typography.Text>
            </div>
          )}
          {response && (responseView === 'Headers' || response.data) ? (
            <div style={{ flex: 1, minHeight: 0 }}>
              <JsonCodeEditor
                height="100%"
                value={responseView === 'Body' ? response.data : response.headers}
                readOnly
                variant="flush"
              />
            </div>
          ) : !responseError && (
            <div className={classes.emptyResponse}>
              <div className={classes.emptyResponseMark} aria-hidden="true">&gt;_</div>
              <Typography.Text strong>Ready for a request</Typography.Text>
              <Typography.Text type="secondary">
                Send {method} to inspect the status, timing, and response body.
              </Typography.Text>
            </div>
          )}
        </Card>
      </div>

      <Drawer
        title="Request history"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        styles={{ wrapper: { width: 440 } }}
        extra={
          <Button
            size="small"
            type="text"
            danger
            disabled={!requestHistory.length}
            onClick={clearHistory}
          >
            Clear all
          </Button>
        }
      >
        {requestHistory.length ? (
          <div className={classes.historyList}>
            {requestHistory.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={classes.historyItem}
                onClick={() => restoreHistoryEntry(entry)}
              >
                <div className={classes.historyHeading}>
                  <Tag color={METHOD_COLORS[entry.method]}>{entry.method}</Tag>
                  <Typography.Text code ellipsis>{entry.endpoint}</Typography.Text>
                </div>
                <div className={classes.historyMeta}>
                  <Typography.Text
                    type={entry.status >= 400 || entry.status === 0 ? 'danger' : 'secondary'}
                  >
                    {entry.status || 'Network error'}
                  </Typography.Text>
                  <Typography.Text type="secondary">{entry.time} ms</Typography.Text>
                  <Typography.Text type="secondary">
                    {new Date(entry.createdAt).toLocaleString()}
                  </Typography.Text>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Executed requests will appear here."
          />
        )}
      </Drawer>

      <ConsolePresets open={presetsOpen} presets={requestPresets} onClose={() => setPresetsOpen(false)} onRestore={restorePreset} onChange={updatePresets} />

      <Modal
        title="Replace request draft?"
        open={pendingReplacement !== null}
        onCancel={() => setPendingReplacement(null)}
        onOk={() => { pendingReplacement?.(); setPendingReplacement(null); }}
        okText="Discard and replace"
        cancelText="Keep editing"
        okButtonProps={{ danger: true }}
        cancelButtonProps={{ autoFocus: true }}
      >
        This will replace unsent request changes. Keep editing to send the request or save it as a session preset first.
      </Modal>
      <Modal
        title="Leave API Console?"
        open={navigationBlocker.status === 'blocked'}
        onCancel={() => navigationBlocker.reset?.()}
        onOk={() => navigationBlocker.proceed?.()}
        okText="Discard and leave"
        cancelText="Keep editing"
        okButtonProps={{ danger: true, disabled: busy }}
        cancelButtonProps={{ autoFocus: true }}
      >
        {busy ? 'A request is still running. Wait for its response before leaving.'
          : 'Your unsent request changes will be lost. Keep editing to send the request or save it as a session preset.'}
      </Modal>
      <Modal
        title="Save session preset"
        open={savePresetOpen}
        okText={replacingPreset ? 'Replace preset' : 'Save preset'}
        okButtonProps={{ disabled: !presetName.trim() }}
        onOk={savePreset}
        onCancel={() => {
          setSavePresetOpen(false);
          setPresetName('');
        }}
      >
        <Typography.Paragraph type="secondary">
          The current method, path, query, and request body will be stored only
          for this browser tab.
        </Typography.Paragraph>
        <Input
          aria-label="Preset name"
          maxLength={128}
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          onPressEnter={(event) => {
            // Closing the dialog must not send the same Enter to the window shortcut.
            event.preventDefault();
            event.stopPropagation();
            savePreset();
          }}
          placeholder="Preset name"
          autoFocus
        />
        <label htmlFor="save-preset-collection" style={{ display: 'block', marginTop: 12 }}>Collection (optional)</label>
        <AutoComplete placement="topLeft" filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())} id="save-preset-collection" aria-label="Preset collection" value={presetGroup} onChange={setPresetGroup} maxLength={64} style={{ width: '100%' }} placeholder="Unfiled"
          options={[...new Set(requestPresets.map((item) => item.collection).filter(Boolean))].map((value) => ({ value }))} />
        {replacingPreset && <Typography.Paragraph role="status" style={{ marginTop: 12, marginBottom: 0 }}>This replaces the existing preset with the same name in this collection.</Typography.Paragraph>}
      </Modal>
    </div>
  );
}

export const Route = createFileRoute('/raw_api/')({
  component: RawApiPage,
});
