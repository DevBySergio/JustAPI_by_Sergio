import type { Collection, CollectionItemRef } from '../models/Collection';
import type { HistoryEntry } from '../models/HistoryEntry';
import type {
  CodeTargetLanguage,
  ExtensionMessage,
  InitialState,
  ProtocolErrorCode,
  SearchResult,
  WebviewMessage,
  WebviewMessageType,
} from '../models/MessageProtocol';
import type { JustRequest } from '../models/Request';
import type { AuthConfig, AuthInput } from '../models/Auth';
import type { JustResponse } from '../models/Response';
import type { Variable } from '../models/Variable';
import type { VariableSet } from '../models/VariableSet';
import type { VariableDiagnostic } from '../models/VariableResolution';

export const PROTOCOL_LIMITS = {
  generalMessageBytes: 1024 * 1024,
  importMessageBytes: 10 * 1024 * 1024,
  maximumDepth: 50,
  maximumNodes: 100_000,
  maximumCollections: 1_000,
  maximumRequests: 10_000,
  maximumCollectionItems: 10_000,
  maximumVariables: 1_000,
  maximumHistoryEntries: 200,
  maximumHeaders: 200,
  maximumCookies: 200,
  maximumUrlLength: 16 * 1024,
  maximumHeaderNameLength: 1024,
  maximumValueLength: 64 * 1024,
  maximumBodyLength: 10 * 1024 * 1024,
  maximumNameLength: 1024,
  maximumErrorLength: 4096,
  maximumDiagnostics: 200,
} as const;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ProtocolErrorCode; message: string };

export interface CollectionImportDocument {
  collection: Collection;
  requests: JustRequest[];
}

const WEBVIEW_MESSAGE_TYPES: readonly WebviewMessageType[] = [
  'executeRequest',
  'cancelRequest',
  'saveRequest',
  'deleteRequest',
  'configureAuth',
  'getCollections',
  'getRequest',
  'createCollection',
  'updateCollection',
  'deleteCollection',
  'duplicateCollection',
  'renameCollection',
  'moveItem',
  'getHistory',
  'clearHistory',
  'deleteHistoryEntry',
  'getVariables',
  'setGlobalVariables',
  'getSettings',
  'setSettings',
  'search',
  'importCurl',
  'exportCollection',
  'importCollection',
  'generateCode',
  'webviewReady',
  'previewResolution',
  'getVariableSets',
  'createVariableSet',
  'updateVariableSet',
  'deleteVariableSet',
  'linkVariableSet',
  'unlinkVariableSet',
];

const WEBVIEW_MESSAGE_TYPE_SET = new Set<string>(WEBVIEW_MESSAGE_TYPES);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const REQUEST_BODY_TYPES = new Set(['none', 'json', 'form-data', 'x-www-form-urlencoded', 'text', 'xml', 'binary']);
const RESPONSE_BODY_TYPES = new Set(['json', 'html', 'xml', 'text', 'image', 'binary', 'unknown']);
const REQUEST_ERROR_TYPES = new Set(['network', 'timeout', 'dns', 'ssl', 'invalid-response', 'aborted', 'unknown']);
const VARIABLE_SCOPES = new Set(['request', 'collection', 'global']);
const CODE_TARGET_LANGUAGES = new Set<CodeTargetLanguage>([
  'javascript',
  'typescript',
  'python',
  'curl',
  'csharp',
  'java',
  'go',
]);
const PROTOCOL_ERROR_CODES = new Set<ProtocolErrorCode>([
  'INVALID_MESSAGE',
  'UNKNOWN_MESSAGE',
  'MESSAGE_TOO_LARGE',
  'INVALID_PAYLOAD',
  'DUPLICATE_OPERATION',
  'DUPLICATE_EXECUTION',
  'EXECUTION_NOT_FOUND',
  'IMPORT_ERROR',
  'AUTH_CONFLICT',
  'AUTH_SECRET_NOT_FOUND',
  'VARIABLE_RESOLUTION_FAILED',
  'OPERATION_FAILED',
  'OUTBOUND_MESSAGE_INVALID',
]);

function failure<T>(code: ProtocolErrorCode): ValidationResult<T> {
  const messages: Record<ProtocolErrorCode, string> = {
    INVALID_MESSAGE: 'The protocol message envelope is invalid.',
    UNKNOWN_MESSAGE: 'The protocol message type is not supported.',
    MESSAGE_TOO_LARGE: 'The protocol message exceeds the allowed size.',
    INVALID_PAYLOAD: 'The protocol message payload is invalid.',
    DUPLICATE_OPERATION: 'The operation identifier has already been used.',
    DUPLICATE_EXECUTION: 'The execution identifier has already been used.',
    EXECUTION_NOT_FOUND: 'The requested execution is not active.',
    IMPORT_ERROR: 'The import document is invalid.',
    AUTH_CONFLICT: 'Authentication conflicts with an enabled request field.',
    AUTH_SECRET_NOT_FOUND: 'The configured authentication secret is unavailable.',
    VARIABLE_RESOLUTION_FAILED: 'The request contains invalid or unresolved variables.',
    OPERATION_FAILED: 'The requested operation could not be completed.',
    OUTBOUND_MESSAGE_INVALID: 'The extension produced an invalid protocol response.',
  };
  return { ok: false, code, message: messages[code] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every(key => allowed.has(key));
}

function isString(value: unknown, maximumLength: number, allowEmpty = true): value is string {
  return typeof value === 'string'
    && value.length <= maximumLength
    && (allowEmpty || value.length > 0);
}

export function isProtocolIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{1,64}$/.test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function inspectStructure(value: unknown, maximumBytes: number): ValidationResult<unknown> {
  let nodeCount = 0;
  const ancestors = new Set<object>();

  const visit = (candidate: unknown, depth: number): boolean => {
    nodeCount += 1;
    if (nodeCount > PROTOCOL_LIMITS.maximumNodes || depth > PROTOCOL_LIMITS.maximumDepth) {
      return false;
    }
    if (candidate === undefined
      || candidate === null
      || typeof candidate === 'string'
      || typeof candidate === 'boolean') {
      return true;
    }
    if (typeof candidate === 'number') {
      return Number.isFinite(candidate);
    }
    if (typeof candidate !== 'object') {
      return false;
    }
    if (ancestors.has(candidate)) {
      return false;
    }
    ancestors.add(candidate);

    let valid = true;
    if (Array.isArray(candidate)) {
      if (candidate.length > PROTOCOL_LIMITS.maximumNodes) {
        valid = false;
      } else {
        for (const item of candidate) {
          if (!visit(item, depth + 1)) {
            valid = false;
            break;
          }
        }
      }
    } else if (isRecord(candidate)) {
      const entries = Object.entries(candidate);
      if (entries.length > PROTOCOL_LIMITS.maximumNodes) {
        valid = false;
      } else {
        for (const [key, item] of entries) {
          if (!isString(key, PROTOCOL_LIMITS.maximumNameLength) || !visit(item, depth + 1)) {
            valid = false;
            break;
          }
        }
      }
    } else {
      valid = false;
    }

    ancestors.delete(candidate);
    return valid;
  };

  if (!visit(value, 0)) {
    return failure('INVALID_PAYLOAD');
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return failure('INVALID_PAYLOAD');
    }
    if (utf8ByteLength(serialized) > maximumBytes) {
      return failure('MESSAGE_TOO_LARGE');
    }
  } catch {
    return failure('INVALID_PAYLOAD');
  }

  return { ok: true, value };
}

function isKeyValuePair(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'key', 'value', 'enabled'])
    && isProtocolIdentifier(value.id)
    && isString(value.key, PROTOCOL_LIMITS.maximumHeaderNameLength)
    && isString(value.value, PROTOCOL_LIMITS.maximumValueLength)
    && typeof value.enabled === 'boolean';
}

function isPathParam(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'name', 'value'])
    && isProtocolIdentifier(value.id)
    && isString(value.name, PROTOCOL_LIMITS.maximumHeaderNameLength)
    && isString(value.value, PROTOCOL_LIMITS.maximumValueLength);
}

function isVariable(value: unknown): value is Variable {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'key', 'value', 'enabled', 'scope'], ['collectionId'])
    && isProtocolIdentifier(value.id)
    && isString(value.key, PROTOCOL_LIMITS.maximumHeaderNameLength)
    && isString(value.value, PROTOCOL_LIMITS.maximumValueLength)
    && typeof value.enabled === 'boolean'
    && typeof value.scope === 'string'
    && VARIABLE_SCOPES.has(value.scope)
    && (value.collectionId === undefined || isProtocolIdentifier(value.collectionId));
}

function isVariableArray(value: unknown): value is Variable[] {
  return Array.isArray(value)
    && value.length <= PROTOCOL_LIMITS.maximumVariables
    && value.every(isVariable);
}

const VARIABLE_DIAGNOSTIC_CODES = new Set([
  'MISSING_VARIABLE',
  'DISABLED_VARIABLE',
  'DUPLICATE_VARIABLE',
  'CYCLIC_VARIABLE',
  'MAX_DEPTH_EXCEEDED',
  'INVALID_VARIABLE',
  'INVALID_TEMPLATE',
  'INPUT_LIMIT_EXCEEDED',
  'OUTPUT_LIMIT_EXCEEDED',
]);

function isVariableDiagnostic(value: unknown): value is VariableDiagnostic {
  return isRecord(value)
    && hasOnlyKeys(value, ['code', 'location'], ['variable', 'path'])
    && typeof value.code === 'string'
    && VARIABLE_DIAGNOSTIC_CODES.has(value.code)
    && isString(value.location, PROTOCOL_LIMITS.maximumNameLength, false)
    && (value.variable === undefined
      || isString(value.variable, PROTOCOL_LIMITS.maximumHeaderNameLength, false))
    && (value.path === undefined
      || (Array.isArray(value.path)
        && value.path.length <= PROTOCOL_LIMITS.maximumDepth
        && value.path.every(segment => isString(segment, PROTOCOL_LIMITS.maximumHeaderNameLength, false))));
}

function isAuthConfig(value: unknown): value is AuthConfig {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'none':
      return hasOnlyKeys(value, ['type']);
    case 'bearer':
    case 'basic':
      return hasOnlyKeys(value, ['type', 'configured']) && value.configured === true;
    case 'apiKey':
      return hasOnlyKeys(value, ['type', 'name', 'in', 'configured'])
        && isString(value.name, PROTOCOL_LIMITS.maximumHeaderNameLength, false)
        && (value.in === 'header' || value.in === 'query')
        && value.configured === true;
    default:
      return false;
  }
}

function isAuthInput(value: unknown): value is AuthInput {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'none':
      return hasOnlyKeys(value, ['type']);
    case 'bearer':
      return hasOnlyKeys(value, ['type', 'token'])
        && isString(value.token, PROTOCOL_LIMITS.maximumValueLength, false);
    case 'basic':
      return hasOnlyKeys(value, ['type', 'username', 'password'])
        && isString(value.username, PROTOCOL_LIMITS.maximumValueLength)
        && isString(value.password, PROTOCOL_LIMITS.maximumValueLength);
    case 'apiKey':
      return hasOnlyKeys(value, ['type', 'name', 'in', 'value'])
        && isString(value.name, PROTOCOL_LIMITS.maximumHeaderNameLength, false)
        && (value.in === 'header' || value.in === 'query')
        && isString(value.value, PROTOCOL_LIMITS.maximumValueLength, false);
    default:
      return false;
  }
}

export function isJustRequest(value: unknown): value is JustRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'id',
    'name',
    'method',
    'url',
    'headers',
    'queryParams',
    'auth',
    'pathParams',
    'body',
    'settings',
    'variables',
    'created',
    'updated',
  ])) {
    return false;
  }

  if (!isProtocolIdentifier(value.id)
    || !isString(value.name, PROTOCOL_LIMITS.maximumNameLength)
    || typeof value.method !== 'string'
    || !HTTP_METHODS.has(value.method)
    || !isString(value.url, PROTOCOL_LIMITS.maximumUrlLength)
    || !Array.isArray(value.headers)
    || value.headers.length > PROTOCOL_LIMITS.maximumHeaders
    || !value.headers.every(isKeyValuePair)
    || !Array.isArray(value.queryParams)
    || value.queryParams.length > PROTOCOL_LIMITS.maximumHeaders
    || !value.queryParams.every(isKeyValuePair)
    || !isAuthConfig(value.auth)
    || !Array.isArray(value.pathParams)
    || value.pathParams.length > PROTOCOL_LIMITS.maximumHeaders
    || !value.pathParams.every(isPathParam)
    || !isVariableArray(value.variables)
    || !isTimestamp(value.created)
    || !isTimestamp(value.updated)) {
    return false;
  }

  const body = value.body;
  if (!isRecord(body)
    || !hasOnlyKeys(body, ['type', 'content'], ['formData'])
    || typeof body.type !== 'string'
    || !REQUEST_BODY_TYPES.has(body.type)
    || !isString(body.content, PROTOCOL_LIMITS.maximumBodyLength)
    || (body.formData !== undefined
      && (!Array.isArray(body.formData)
        || body.formData.length > PROTOCOL_LIMITS.maximumHeaders
        || !body.formData.every(isKeyValuePair)))) {
    return false;
  }

  const settings = value.settings;
  return isRecord(settings)
    && hasOnlyKeys(settings, ['timeout', 'followRedirects', 'verifySSL'])
    && isBoundedInteger(settings.timeout, 1, 600_000)
    && typeof settings.followRedirects === 'boolean'
    && typeof settings.verifySSL === 'boolean';
}

function isCollectionItem(value: unknown, depth: number, counter: { count: number }): value is CollectionItemRef {
  if (depth > PROTOCOL_LIMITS.maximumDepth
    || !isRecord(value)
    || !hasOnlyKeys(value, ['type', 'id', 'name'], ['items', 'requestId'])
    || (value.type !== 'folder' && value.type !== 'request')
    || !isProtocolIdentifier(value.id)
    || !isString(value.name, PROTOCOL_LIMITS.maximumNameLength)) {
    return false;
  }
  counter.count += 1;
  if (counter.count > PROTOCOL_LIMITS.maximumCollectionItems) {
    return false;
  }
  if (value.type === 'request') {
    return isProtocolIdentifier(value.requestId) && value.items === undefined;
  }
  if (value.requestId !== undefined || !Array.isArray(value.items)) {
    return false;
  }
  return value.items.every(item => isCollectionItem(item, depth + 1, counter));
}

export function isCollection(value: unknown): value is Collection {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['id', 'name', 'items', 'variables', 'created', 'updated'], ['description'])
    || !isProtocolIdentifier(value.id)
    || !isString(value.name, PROTOCOL_LIMITS.maximumNameLength, false)
    || (value.description !== undefined && !isString(value.description, PROTOCOL_LIMITS.maximumValueLength))
    || !Array.isArray(value.items)
    || !isVariableArray(value.variables)
    || !isTimestamp(value.created)
    || !isTimestamp(value.updated)) {
    return false;
  }
  const counter = { count: 0 };
  return value.items.every(item => isCollectionItem(item, 1, counter));
}

function isVariableSet(value: unknown): value is VariableSet {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'name', 'variables', 'linkedCollectionIds', 'created', 'updated'])
    && isProtocolIdentifier(value.id)
    && isString(value.name, PROTOCOL_LIMITS.maximumNameLength, false)
    && isVariableArray(value.variables)
    && Array.isArray(value.linkedCollectionIds)
    && value.linkedCollectionIds.length <= PROTOCOL_LIMITS.maximumCollections
    && value.linkedCollectionIds.every(isProtocolIdentifier)
    && isTimestamp(value.created)
    && isTimestamp(value.updated);
}

function isJustResponse(value: unknown): value is JustResponse {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'statusCode',
      'statusText',
      'httpVersion',
      'headers',
      'body',
      'bodyType',
      'size',
      'duration',
      'cookies',
      'redirected',
    ], ['error', 'finalUrl'])
    || !isBoundedInteger(value.statusCode, 0, 999)
    || !isString(value.statusText, PROTOCOL_LIMITS.maximumNameLength)
    || !isString(value.httpVersion, 64)
    || !isRecord(value.headers)
    || Object.keys(value.headers).length > PROTOCOL_LIMITS.maximumHeaders
    || !Object.entries(value.headers).every(([key, headerValue]) =>
      isString(key, PROTOCOL_LIMITS.maximumHeaderNameLength)
      && isString(headerValue, PROTOCOL_LIMITS.maximumValueLength))
    || !isString(value.body, PROTOCOL_LIMITS.maximumBodyLength)
    || typeof value.bodyType !== 'string'
    || !RESPONSE_BODY_TYPES.has(value.bodyType)
    || !isBoundedInteger(value.size, 0, 100 * 1024 * 1024)
    || typeof value.duration !== 'number'
    || !Number.isFinite(value.duration)
    || value.duration < 0
    || !Array.isArray(value.cookies)
    || value.cookies.length > PROTOCOL_LIMITS.maximumCookies
    || typeof value.redirected !== 'boolean'
    || (value.finalUrl !== undefined && !isString(value.finalUrl, PROTOCOL_LIMITS.maximumUrlLength))) {
    return false;
  }

  for (const cookie of value.cookies) {
    if (!isRecord(cookie)
      || !hasOnlyKeys(cookie, ['name', 'value'], ['domain', 'path', 'expires', 'httpOnly', 'secure'])
      || !isString(cookie.name, PROTOCOL_LIMITS.maximumHeaderNameLength, false)
      || !isString(cookie.value, PROTOCOL_LIMITS.maximumValueLength)
      || (cookie.domain !== undefined && !isString(cookie.domain, PROTOCOL_LIMITS.maximumNameLength))
      || (cookie.path !== undefined && !isString(cookie.path, PROTOCOL_LIMITS.maximumUrlLength))
      || (cookie.expires !== undefined && !isString(cookie.expires, PROTOCOL_LIMITS.maximumNameLength))
      || (cookie.httpOnly !== undefined && typeof cookie.httpOnly !== 'boolean')
      || (cookie.secure !== undefined && typeof cookie.secure !== 'boolean')) {
      return false;
    }
  }

  if (value.error !== undefined) {
    const error = value.error;
    if (!isRecord(error)
      || !hasOnlyKeys(error, ['type', 'message'])
      || typeof error.type !== 'string'
      || !REQUEST_ERROR_TYPES.has(error.type)
      || !isString(error.message, PROTOCOL_LIMITS.maximumErrorLength)) {
      return false;
    }
  }
  return true;
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'id',
      'timestamp',
      'duration',
      'statusCode',
      'url',
      'method',
      'responseSize',
    ], ['requestId', 'collectionId', 'contentType', 'errorType'])
    && isProtocolIdentifier(value.id)
    && isTimestamp(value.timestamp)
    && typeof value.duration === 'number'
    && Number.isFinite(value.duration)
    && value.duration >= 0
    && isBoundedInteger(value.statusCode, 0, 999)
    && isString(value.url, PROTOCOL_LIMITS.maximumUrlLength)
    && typeof value.method === 'string'
    && HTTP_METHODS.has(value.method)
    && isBoundedInteger(value.responseSize, 0, 100 * 1024 * 1024)
    && (value.requestId === undefined || isProtocolIdentifier(value.requestId))
    && (value.collectionId === undefined || isProtocolIdentifier(value.collectionId))
    && (value.contentType === undefined || isString(value.contentType, 256, false))
    && (value.errorType === undefined
      || (typeof value.errorType === 'string' && REQUEST_ERROR_TYPES.has(value.errorType)));
}

function isSearchResult(value: unknown): value is SearchResult {
  return isRecord(value)
    && hasOnlyKeys(value, ['type', 'id', 'name', 'matchField'], ['collectionId', 'url'])
    && (value.type === 'collection' || value.type === 'folder' || value.type === 'request')
    && isProtocolIdentifier(value.id)
    && isString(value.name, PROTOCOL_LIMITS.maximumNameLength)
    && (value.collectionId === undefined || isProtocolIdentifier(value.collectionId))
    && (value.url === undefined || isString(value.url, PROTOCOL_LIMITS.maximumUrlLength))
    && (value.matchField === 'name'
      || value.matchField === 'url'
      || value.matchField === 'variable'
      || value.matchField === 'header');
}

function isInitialState(value: unknown): value is InitialState {
  return isRecord(value)
    && hasOnlyKeys(value, ['collections', 'history', 'variables', 'variableSets', 'settings'])
    && Array.isArray(value.collections)
    && value.collections.length <= PROTOCOL_LIMITS.maximumCollections
    && value.collections.every(isCollection)
    && Array.isArray(value.history)
    && value.history.length <= PROTOCOL_LIMITS.maximumHistoryEntries
    && value.history.every(isHistoryEntry)
    && isVariableArray(value.variables)
    && Array.isArray(value.variableSets)
    && value.variableSets.length <= PROTOCOL_LIMITS.maximumVariables
    && value.variableSets.every(isVariableSet)
    && isRecord(value.settings);
}

function hasOperationId(value: Record<string, unknown>): boolean {
  return isProtocolIdentifier(value.operationId);
}

function hasExecutionId(value: Record<string, unknown>): boolean {
  return isProtocolIdentifier(value.executionId);
}

function validNoPayloadMessage(value: Record<string, unknown>): boolean {
  return hasOnlyKeys(value, ['type', 'operationId']) && hasOperationId(value);
}

function validateWebviewPayload(value: Record<string, unknown>): boolean {
  if (typeof value.type !== 'string' || !WEBVIEW_MESSAGE_TYPE_SET.has(value.type) || !hasOperationId(value)) {
    return false;
  }

  switch (value.type as WebviewMessageType) {
    case 'executeRequest':
      return hasOnlyKeys(value, ['type', 'operationId', 'executionId', 'request'], ['collectionId'])
        && hasExecutionId(value)
        && isJustRequest(value.request)
        && (value.collectionId === undefined || isProtocolIdentifier(value.collectionId));
    case 'cancelRequest':
      return hasOnlyKeys(value, ['type', 'operationId', 'executionId']) && hasExecutionId(value);
    case 'saveRequest':
      return hasOnlyKeys(value, ['type', 'operationId', 'request', 'collectionId'], ['parentId'])
        && isJustRequest(value.request)
        && isProtocolIdentifier(value.collectionId)
        && (value.parentId === undefined || isProtocolIdentifier(value.parentId));
    case 'deleteRequest':
      return hasOnlyKeys(value, ['type', 'operationId', 'requestId', 'collectionId'])
        && isProtocolIdentifier(value.requestId)
        && isProtocolIdentifier(value.collectionId);
    case 'configureAuth':
      return hasOnlyKeys(value, ['type', 'operationId', 'requestId', 'auth'])
        && isProtocolIdentifier(value.requestId)
        && isAuthInput(value.auth);
    case 'getCollections':
    case 'clearHistory':
    case 'getVariables':
    case 'getSettings':
    case 'webviewReady':
    case 'getVariableSets':
      return validNoPayloadMessage(value);
    case 'getRequest':
      return hasOnlyKeys(value, ['type', 'operationId', 'requestId']) && isProtocolIdentifier(value.requestId);
    case 'createCollection':
    case 'createVariableSet':
      return hasOnlyKeys(value, ['type', 'operationId', 'name'])
        && isString(value.name, PROTOCOL_LIMITS.maximumNameLength, false);
    case 'updateCollection':
      return hasOnlyKeys(value, ['type', 'operationId', 'collection']) && isCollection(value.collection);
    case 'deleteCollection':
    case 'duplicateCollection':
      return hasOnlyKeys(value, ['type', 'operationId', 'collectionId'])
        && isProtocolIdentifier(value.collectionId);
    case 'exportCollection':
      return hasOnlyKeys(value, ['type', 'operationId', 'collectionId'], ['includeCredentials'])
        && isProtocolIdentifier(value.collectionId)
        && (value.includeCredentials === undefined || typeof value.includeCredentials === 'boolean');
    case 'renameCollection':
      return hasOnlyKeys(value, ['type', 'operationId', 'collectionId', 'name'])
        && isProtocolIdentifier(value.collectionId)
        && isString(value.name, PROTOCOL_LIMITS.maximumNameLength, false);
    case 'moveItem':
      return hasOnlyKeys(value, [
        'type',
        'operationId',
        'itemId',
        'sourceCollectionId',
        'targetCollectionId',
      ], ['targetParentId'])
        && isProtocolIdentifier(value.itemId)
        && isProtocolIdentifier(value.sourceCollectionId)
        && isProtocolIdentifier(value.targetCollectionId)
        && (value.targetParentId === undefined || isProtocolIdentifier(value.targetParentId));
    case 'getHistory':
      return hasOnlyKeys(value, ['type', 'operationId'], ['filter', 'limit'])
        && (value.filter === undefined || isString(value.filter, PROTOCOL_LIMITS.maximumNameLength))
        && (value.limit === undefined
          || isBoundedInteger(value.limit, 1, PROTOCOL_LIMITS.maximumHistoryEntries));
    case 'deleteHistoryEntry':
      return hasOnlyKeys(value, ['type', 'operationId', 'entryId']) && isProtocolIdentifier(value.entryId);
    case 'setGlobalVariables':
      return hasOnlyKeys(value, ['type', 'operationId', 'variables']) && isVariableArray(value.variables);
    case 'setSettings':
      return hasOnlyKeys(value, ['type', 'operationId', 'settings']) && isRecord(value.settings);
    case 'search':
      return hasOnlyKeys(value, ['type', 'operationId', 'query'])
        && isString(value.query, 4096);
    case 'importCurl':
      return hasOnlyKeys(value, ['type', 'operationId', 'curlString'])
        && isString(value.curlString, PROTOCOL_LIMITS.generalMessageBytes, false);
    case 'importCollection':
      return hasOnlyKeys(value, ['type', 'operationId', 'json'])
        && isString(value.json, PROTOCOL_LIMITS.importMessageBytes, false);
    case 'generateCode':
      return hasOnlyKeys(
        value,
        ['type', 'operationId', 'request', 'language'],
        ['includeCredentials', 'collectionId']
      )
        && isJustRequest(value.request)
        && typeof value.language === 'string'
        && CODE_TARGET_LANGUAGES.has(value.language as CodeTargetLanguage)
        && (value.includeCredentials === undefined || typeof value.includeCredentials === 'boolean')
        && (value.collectionId === undefined || isProtocolIdentifier(value.collectionId));
    case 'previewResolution':
      return hasOnlyKeys(value, ['type', 'operationId', 'request'], ['collectionId'])
        && (value.request === null || isJustRequest(value.request))
        && (value.collectionId === undefined || isProtocolIdentifier(value.collectionId));
    case 'updateVariableSet':
      return hasOnlyKeys(value, ['type', 'operationId', 'set']) && isVariableSet(value.set);
    case 'deleteVariableSet':
      return hasOnlyKeys(value, ['type', 'operationId', 'setId']) && isProtocolIdentifier(value.setId);
    case 'linkVariableSet':
    case 'unlinkVariableSet':
      return hasOnlyKeys(value, ['type', 'operationId', 'setId', 'collectionId'])
        && isProtocolIdentifier(value.setId)
        && isProtocolIdentifier(value.collectionId);
  }
}

export function validateWebviewMessage(value: unknown): ValidationResult<WebviewMessage> {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return failure('INVALID_MESSAGE');
  }
  if (!WEBVIEW_MESSAGE_TYPE_SET.has(value.type)) {
    return failure('UNKNOWN_MESSAGE');
  }
  const maximumBytes = value.type === 'importCollection'
    ? PROTOCOL_LIMITS.importMessageBytes
    : PROTOCOL_LIMITS.generalMessageBytes;
  const structure = inspectStructure(value, maximumBytes);
  if (!structure.ok) {
    return structure;
  }
  if (!validateWebviewPayload(value)) {
    return failure('INVALID_PAYLOAD');
  }
  return { ok: true, value: value as unknown as WebviewMessage };
}

function validateExtensionPayload(value: Record<string, unknown>): boolean {
  if (typeof value.type !== 'string' || !hasOperationId(value)) {
    return false;
  }
  switch (value.type) {
    case 'collections':
      return hasOnlyKeys(value, ['type', 'operationId', 'collections'])
        && Array.isArray(value.collections)
        && value.collections.length <= PROTOCOL_LIMITS.maximumCollections
        && value.collections.every(isCollection);
    case 'requestLoaded':
    case 'curlImportResult':
      return hasOnlyKeys(value, ['type', 'operationId', 'request']) && isJustRequest(value.request);
    case 'requestAuthUpdated':
      return hasOnlyKeys(value, ['type', 'operationId', 'requestId', 'auth'])
        && isProtocolIdentifier(value.requestId)
        && isAuthConfig(value.auth);
    case 'history':
      return hasOnlyKeys(value, ['type', 'operationId', 'entries'])
        && Array.isArray(value.entries)
        && value.entries.length <= PROTOCOL_LIMITS.maximumHistoryEntries
        && value.entries.every(isHistoryEntry);
    case 'historyEntry':
      return hasOnlyKeys(value, ['type', 'operationId', 'executionId', 'entry'])
        && hasExecutionId(value)
        && isHistoryEntry(value.entry);
    case 'response':
      return hasOnlyKeys(value, ['type', 'operationId', 'executionId', 'response'])
        && hasExecutionId(value)
        && isJustResponse(value.response);
    case 'variables':
      return hasOnlyKeys(value, ['type', 'operationId', 'variables']) && isVariableArray(value.variables);
    case 'settings':
      return hasOnlyKeys(value, ['type', 'operationId', 'settings']) && isRecord(value.settings);
    case 'searchResults':
      return hasOnlyKeys(value, ['type', 'operationId', 'results'])
        && Array.isArray(value.results)
        && value.results.length <= PROTOCOL_LIMITS.maximumCollectionItems
        && value.results.every(isSearchResult);
    case 'codeGenerationResult':
      return hasOnlyKeys(value, ['type', 'operationId', 'code', 'language'])
        && isString(value.code, PROTOCOL_LIMITS.maximumBodyLength)
        && typeof value.language === 'string'
        && CODE_TARGET_LANGUAGES.has(value.language as CodeTargetLanguage);
    case 'error':
      return hasOnlyKeys(value, ['type', 'operationId', 'message', 'code'], ['executionId'])
        && isString(value.message, PROTOCOL_LIMITS.maximumErrorLength, false)
        && typeof value.code === 'string'
        && PROTOCOL_ERROR_CODES.has(value.code as ProtocolErrorCode)
        && (value.executionId === undefined || isProtocolIdentifier(value.executionId));
    case 'requestExecuting':
      return hasOnlyKeys(value, ['type', 'operationId', 'executionId', 'executing'])
        && hasExecutionId(value)
        && typeof value.executing === 'boolean';
    case 'initialState':
      return hasOnlyKeys(value, ['type', 'operationId', 'state']) && isInitialState(value.state);
    case 'variableSets':
      return hasOnlyKeys(value, ['type', 'operationId', 'sets'])
        && Array.isArray(value.sets)
        && value.sets.length <= PROTOCOL_LIMITS.maximumVariables
        && value.sets.every(isVariableSet);
    case 'resolutionPreview':
      return hasOnlyKeys(value, [
        'type',
        'operationId',
        'resolvedUrl',
        'resolvedHeaders',
        'resolvedQueryParams',
        'resolvedBody',
        'diagnostics',
        'canExecute',
      ])
        && isString(value.resolvedUrl, PROTOCOL_LIMITS.maximumUrlLength)
        && isString(value.resolvedHeaders, PROTOCOL_LIMITS.generalMessageBytes)
        && isString(value.resolvedQueryParams, PROTOCOL_LIMITS.generalMessageBytes)
        && isString(value.resolvedBody, PROTOCOL_LIMITS.maximumBodyLength)
        && Array.isArray(value.diagnostics)
        && value.diagnostics.length <= PROTOCOL_LIMITS.maximumDiagnostics
        && value.diagnostics.every(isVariableDiagnostic)
        && typeof value.canExecute === 'boolean';
    case 'createNewRequest':
      return hasOnlyKeys(value, ['type', 'operationId']);
    case 'acknowledgement':
      return hasOnlyKeys(value, ['type', 'operationId', 'action', 'status'], ['executionId'])
        && typeof value.action === 'string'
        && WEBVIEW_MESSAGE_TYPE_SET.has(value.action)
        && value.status === 'completed'
        && (value.executionId === undefined || isProtocolIdentifier(value.executionId));
    default:
      return false;
  }
}

export function validateExtensionMessage(value: unknown): ValidationResult<ExtensionMessage> {
  const structure = inspectStructure(value, PROTOCOL_LIMITS.generalMessageBytes);
  if (!structure.ok) {
    return structure;
  }
  if (!isRecord(value) || !validateExtensionPayload(value)) {
    return failure('INVALID_PAYLOAD');
  }
  return { ok: true, value: value as unknown as ExtensionMessage };
}

export function validateCollectionImportDocument(json: string): ValidationResult<CollectionImportDocument> {
  if (utf8ByteLength(json) > PROTOCOL_LIMITS.importMessageBytes) {
    return failure('MESSAGE_TOO_LARGE');
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return failure('IMPORT_ERROR');
  }
  const structure = inspectStructure(value, PROTOCOL_LIMITS.importMessageBytes);
  if (!structure.ok) {
    return structure.code === 'MESSAGE_TOO_LARGE' ? structure : failure('IMPORT_ERROR');
  }
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['collection', 'requests'])
    || !isCollection(value.collection)
    || !Array.isArray(value.requests)
    || value.requests.length > PROTOCOL_LIMITS.maximumRequests
    || !value.requests.every(isJustRequest)) {
    return failure('IMPORT_ERROR');
  }
  return {
    ok: true,
    value: {
      collection: value.collection,
      requests: value.requests,
    },
  };
}

export function protocolFailure(code: ProtocolErrorCode): { code: ProtocolErrorCode; message: string } {
  const result = failure<never>(code);
  if (result.ok) {
    throw new Error('Protocol failure construction failed.');
  }
  return { code: result.code, message: result.message };
}
