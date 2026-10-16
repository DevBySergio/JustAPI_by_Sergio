import type { KeyValuePair } from '../models/KeyValuePair';
import type { JustRequest } from '../models/Request';
import { validateWebviewMessage } from '../protocol/MessageValidator';
import { redactUrlQueryValues, redactUrlUserInfo } from '../engine/auth/UrlRedaction';

export type WebviewTab = 'editor' | 'collections' | 'history' | 'variables' | 'codegen';
export type VariableSubTab = 'vars' | 'sets' | 'environments';

export interface PersistedWebviewState {
  schemaVersion: 1;
  activeTab: WebviewTab;
  variableSubTab: VariableSubTab;
  activeCollectionId: string | null;
  currentRequest: JustRequest;
  baselineRequest: JustRequest;
  redactedValues: boolean;
  pendingAuth?: boolean;
}

export const REQUEST_WORKSPACE_LIMITS = { maximumTabs: 20, maximumBytes: 4 * 1024 * 1024 } as const;

export interface PersistedRequestTab {
  tabId: string;
  currentRequest: JustRequest;
  baselineRequest: JustRequest;
  collectionId: string | null;
  baselineCollectionId: string | null;
  pendingAuth: boolean;
}

export interface PersistedRequestWorkspace {
  schemaVersion: 2;
  activeTab: WebviewTab;
  variableSubTab: VariableSubTab;
  activeRequestTabId: string;
  tabs: PersistedRequestTab[];
  redactedValues: boolean;
  pendingEnvironmentEdits?: boolean;
}

const WEBVIEW_TABS = new Set<WebviewTab>([
  'editor',
  'collections',
  'history',
  'variables',
  'codegen',
]);

const SENSITIVE_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'password',
  'passwd',
  'token',
  'access-token',
  'access_token',
  'refresh-token',
  'refresh_token',
  'api-key',
  'api_key',
  'apikey',
  'client-secret',
  'client_secret',
]);
const MAXIMUM_PERSISTED_BODY_CHARACTERS = 200_000;

function normalizedName(value: string): string {
  return value.trim().toLowerCase();
}

function isSensitiveName(value: string, request: JustRequest): boolean {
  const normalized = normalizedName(value);
  return SENSITIVE_NAMES.has(normalized)
    || normalized.endsWith('-token')
    || normalized.endsWith('_token')
    || normalized.endsWith('-secret')
    || normalized.endsWith('_secret')
    || (request.auth.type === 'apiKey' && normalized === normalizedName(request.auth.name));
}

function sanitizePairs(
  pairs: KeyValuePair[],
  request: JustRequest
): { pairs: KeyValuePair[]; redacted: boolean } {
  let redacted = false;
  const safePairs = pairs.map(pair => {
    if (!isSensitiveName(pair.key, request) || pair.value.length === 0) {
      return { ...pair };
    }
    redacted = true;
    return { ...pair, value: '' };
  });
  return { pairs: safePairs, redacted };
}

function sanitizeUrl(value: string, request: JustRequest): { value: string; redacted: boolean } {
  const userInfo = redactUrlUserInfo(value);
  const query = redactUrlQueryValues(userInfo.value, name => isSensitiveName(name, request), '');
  return query.value.length > 16 * 1024 ? { value: '', redacted: true }
    : { value: query.value, redacted: userInfo.redacted || query.redacted };
}

function sanitizeBody(request: JustRequest): { body: JustRequest['body']; redacted: boolean } {
  const sanitized = sanitizeBodyValues(request);
  const redacted = Boolean(sanitized.body.file || sanitized.body.files?.some(field => field.file));
  const body = { ...sanitized.body }; delete body.file;
  if (body.files) { body.files = body.files.map(field => { const copy = { ...field }; delete copy.file; return copy; }); }
  return { body, redacted: sanitized.redacted || redacted };
}

function sanitizeBodyValues(request: JustRequest): { body: JustRequest['body']; redacted: boolean } {
  if (request.body.content.length > MAXIMUM_PERSISTED_BODY_CHARACTERS) {
    return { body: { ...request.body, content: '' }, redacted: true };
  }
  if (request.body.type === 'form-data' && request.body.formData) {
    const sanitized = sanitizePairs(request.body.formData, request);
    let remainingCharacters = MAXIMUM_PERSISTED_BODY_CHARACTERS;
    let omitted = false;
    const formData = sanitized.pairs.map(pair => {
      if (pair.value.length <= remainingCharacters) {
        remainingCharacters -= pair.value.length;
        return pair;
      }
      omitted = true;
      return { ...pair, value: '' };
    });
    return {
      body: { ...request.body, formData },
      redacted: sanitized.redacted || omitted,
    };
  }
  if (request.body.type !== 'json' || request.body.content.length === 0) {
    return { body: { ...request.body }, redacted: false };
  }
  try {
    const parsed: unknown = JSON.parse(request.body.content);
    let redacted = false;
    const visit = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(visit);
      }
      if (value === null || typeof value !== 'object') {
        return value;
      }
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        if (isSensitiveName(key, request) && item !== '') {
          redacted = true;
          return [key, ''];
        }
        return [key, visit(item)];
      }));
    };
    const sanitized = visit(parsed);
    return {
      body: { ...request.body, content: redacted ? JSON.stringify(sanitized, null, 2) : request.body.content },
      redacted,
    };
  } catch {
    return { body: { ...request.body }, redacted: false };
  }
}

export function sanitizeRequestForWebviewState(
  request: JustRequest
): { request: JustRequest; redacted: boolean } {
  const headers = sanitizePairs(request.headers, request);
  const queryParams = sanitizePairs(request.queryParams, request);
  const url = sanitizeUrl(request.url, request);
  const body = sanitizeBody(request);
  return {
    request: {
      ...request,
      url: url.value,
      headers: headers.pairs,
      queryParams: queryParams.pairs,
      body: body.body,
      pathParams: request.pathParams.map(item => ({ ...item })),
      variables: request.variables.map(variable => ({ ...variable })),
      settings: { ...request.settings },
      auth: { ...request.auth },
    },
    redacted: headers.redacted || queryParams.redacted || url.redacted || body.redacted,
  };
}

function isValidRequest(value: unknown): value is JustRequest {
  return validateWebviewMessage({
    type: 'previewResolution',
    operationId: 'operation-webview-state',
    request: value,
  }).ok;
}

export function createPersistedWebviewState(input: Omit<
  PersistedWebviewState,
  'schemaVersion' | 'redactedValues'
>): PersistedWebviewState {
  const current = sanitizeRequestForWebviewState(input.currentRequest);
  const baseline = sanitizeRequestForWebviewState(input.baselineRequest);
  return {
    schemaVersion: 1,
    activeTab: input.activeTab,
    variableSubTab: input.variableSubTab,
    activeCollectionId: input.activeCollectionId,
    currentRequest: current.request,
    baselineRequest: baseline.request,
    pendingAuth: input.pendingAuth ?? false,
    redactedValues: current.redacted || baseline.redacted,
  };
}

export function restorePersistedWebviewState(value: unknown): PersistedWebviewState | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1
    || typeof candidate.activeTab !== 'string'
    || !WEBVIEW_TABS.has(candidate.activeTab as WebviewTab)
    || (candidate.variableSubTab !== 'vars' && candidate.variableSubTab !== 'sets' && candidate.variableSubTab !== 'environments')
    || (candidate.activeCollectionId !== null && typeof candidate.activeCollectionId !== 'string')
    || !isValidRequest(candidate.currentRequest)
    || !isValidRequest(candidate.baselineRequest)
    || typeof candidate.redactedValues !== 'boolean') {
    return null;
  }
  const current = sanitizeRequestForWebviewState(candidate.currentRequest);
  const baseline = sanitizeRequestForWebviewState(candidate.baselineRequest);
  if (candidate.pendingAuth === true) { current.request.auth = baseline.request.auth; }
  return {
    schemaVersion: 1,
    activeTab: candidate.activeTab as WebviewTab,
    variableSubTab: candidate.variableSubTab,
    activeCollectionId: candidate.activeCollectionId,
    currentRequest: current.request,
    baselineRequest: baseline.request,
    pendingAuth: false,
    redactedValues: candidate.redactedValues || current.redacted || baseline.redacted || candidate.pendingAuth === true,
  };
}

export function createPersistedRequestWorkspace(input: Omit<PersistedRequestWorkspace, 'schemaVersion' | 'redactedValues'>): PersistedRequestWorkspace {
  let redactedValues = false;
  const tabs = input.tabs.slice(0, REQUEST_WORKSPACE_LIMITS.maximumTabs).map(tab => {
    const current = sanitizeRequestForWebviewState(tab.currentRequest);
    const baseline = sanitizeRequestForWebviewState(tab.baselineRequest);
    redactedValues ||= current.redacted || baseline.redacted;
    return { tabId: tab.tabId, currentRequest: current.request, baselineRequest: baseline.request,
      collectionId: tab.collectionId, baselineCollectionId: tab.baselineCollectionId, pendingAuth: tab.pendingAuth };
  });
  const result: PersistedRequestWorkspace = { schemaVersion: 2, activeTab: input.activeTab, variableSubTab: input.variableSubTab,
    activeRequestTabId: input.activeRequestTabId, tabs, redactedValues, pendingEnvironmentEdits: input.pendingEnvironmentEdits ?? false };
  // Keep tab identity and navigation even when a large draft cannot be restored safely.
  const bytes = () => new TextEncoder().encode(JSON.stringify(result)).length;
  for (const tab of [...tabs].sort((left, right) => Number(left.tabId === input.activeRequestTabId) - Number(right.tabId === input.activeRequestTabId))) {
    if (bytes() <= REQUEST_WORKSPACE_LIMITS.maximumBytes) { break; }
    for (const request of [tab.currentRequest, tab.baselineRequest]) {
      request.body = { type: request.body.type, content: '' };
      request.headers = []; request.queryParams = []; request.pathParams = []; request.variables = [];
    }
    result.redactedValues = true;
  }
  return result;
}

export function restoreRequestWorkspace(value: unknown): PersistedRequestWorkspace | null {
  const legacy = restorePersistedWebviewState(value);
  if (legacy) {
    return { schemaVersion: 2, activeTab: legacy.activeTab, variableSubTab: legacy.variableSubTab,
      activeRequestTabId: `tab-${legacy.currentRequest.id}`, redactedValues: legacy.redactedValues,
      tabs: [{ tabId: `tab-${legacy.currentRequest.id}`, currentRequest: legacy.currentRequest,
        baselineRequest: legacy.baselineRequest, collectionId: legacy.activeCollectionId, baselineCollectionId: legacy.activeCollectionId, pendingAuth: false }] };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return null; }
  const candidate = value as Partial<PersistedRequestWorkspace>;
  if (candidate.schemaVersion !== 2 || !WEBVIEW_TABS.has(candidate.activeTab as WebviewTab)
    || (candidate.pendingEnvironmentEdits !== undefined && typeof candidate.pendingEnvironmentEdits !== 'boolean')
    || (candidate.variableSubTab !== 'vars' && candidate.variableSubTab !== 'sets' && candidate.variableSubTab !== 'environments')
    || typeof candidate.activeRequestTabId !== 'string' || typeof candidate.redactedValues !== 'boolean'
    || !Array.isArray(candidate.tabs) || candidate.tabs.length < 1 || candidate.tabs.length > REQUEST_WORKSPACE_LIMITS.maximumTabs) { return null; }
  const ids = new Set<string>();
  const requestIds = new Set<string>();
  for (const tab of candidate.tabs) {
    if (!tab || typeof tab !== 'object' || typeof tab.tabId !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(tab.tabId)
      || ids.has(tab.tabId) || !isValidRequest(tab.currentRequest) || !isValidRequest(tab.baselineRequest)
      || tab.currentRequest.id !== tab.baselineRequest.id || requestIds.has(tab.currentRequest.id)
      || (tab.collectionId !== null && (typeof tab.collectionId !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(tab.collectionId)))
      || (tab.baselineCollectionId !== null && (typeof tab.baselineCollectionId !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(tab.baselineCollectionId)))
      || typeof tab.pendingAuth !== 'boolean') { return null; }
    ids.add(tab.tabId); requestIds.add(tab.currentRequest.id);
  }
  if (!ids.has(candidate.activeRequestTabId)) { return null; }
  const result = createPersistedRequestWorkspace(candidate as PersistedRequestWorkspace);
  result.redactedValues ||= candidate.redactedValues || candidate.pendingEnvironmentEdits === true;
  result.pendingEnvironmentEdits = false;
  for (const tab of result.tabs) {
    if (tab.pendingAuth) { tab.currentRequest.auth = { ...tab.baselineRequest.auth }; result.redactedValues = true; }
    tab.pendingAuth = false;
  }
  return result;
}

function requestComparableValue(request: JustRequest): Omit<JustRequest, 'updated'> {
  const { updated: _updated, ...comparable } = request;
  return comparable;
}

export function requestsDiffer(current: JustRequest, baseline: JustRequest): boolean {
  return JSON.stringify(requestComparableValue(current)) !== JSON.stringify(requestComparableValue(baseline));
}

export function nextTabIndex(
  currentIndex: number,
  key: string,
  tabCount: number
): number | null {
  if (tabCount <= 0) {
    return null;
  }
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return tabCount - 1;
  }
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return (currentIndex + 1) % tabCount;
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return (currentIndex - 1 + tabCount) % tabCount;
  }
  return null;
}
