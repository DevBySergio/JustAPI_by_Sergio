import type { KeyValuePair } from '../models/KeyValuePair';
import type { JustRequest } from '../models/Request';
import { validateWebviewMessage } from '../protocol/MessageValidator';

export type WebviewTab = 'editor' | 'collections' | 'history' | 'variables' | 'codegen';
export type VariableSubTab = 'vars' | 'sets';

export interface PersistedWebviewState {
  schemaVersion: 1;
  activeTab: WebviewTab;
  variableSubTab: VariableSubTab;
  activeCollectionId: string | null;
  currentRequest: JustRequest;
  baselineRequest: JustRequest;
  redactedValues: boolean;
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
  try {
    const url = new URL(value);
    let redacted = false;
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
      redacted = true;
    }
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveName(key, request) && url.searchParams.get(key)) {
        url.searchParams.set(key, '');
        redacted = true;
      }
    }
    return { value: url.toString(), redacted };
  } catch {
    return { value, redacted: false };
  }
}

function sanitizeBody(request: JustRequest): { body: JustRequest['body']; redacted: boolean } {
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
      body: { ...request.body, content: JSON.stringify(sanitized, null, 2) },
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
    || (candidate.variableSubTab !== 'vars' && candidate.variableSubTab !== 'sets')
    || (candidate.activeCollectionId !== null && typeof candidate.activeCollectionId !== 'string')
    || !isValidRequest(candidate.currentRequest)
    || !isValidRequest(candidate.baselineRequest)
    || typeof candidate.redactedValues !== 'boolean') {
    return null;
  }
  const current = sanitizeRequestForWebviewState(candidate.currentRequest);
  const baseline = sanitizeRequestForWebviewState(candidate.baselineRequest);
  return {
    schemaVersion: 1,
    activeTab: candidate.activeTab as WebviewTab,
    variableSubTab: candidate.variableSubTab,
    activeCollectionId: candidate.activeCollectionId,
    currentRequest: current.request,
    baselineRequest: baseline.request,
    redactedValues: candidate.redactedValues || current.redacted || baseline.redacted,
  };
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
