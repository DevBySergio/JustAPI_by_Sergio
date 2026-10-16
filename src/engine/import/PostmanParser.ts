import { redactUrlUserInfo } from '../auth/UrlRedaction';
import { TextDecoder } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { AuthInput } from '../../models/Auth';
import { createDefaultCollection, type CollectionItemRef } from '../../models/Collection';
import type { CollectionTransferDocument } from '../../models/CollectionTransfer';
import { createDefaultRequest, type JustRequest, type HttpMethod } from '../../models/Request';
import type { KeyValuePair } from '../../models/KeyValuePair';
import type { Variable } from '../../models/Variable';
import type { PostmanImportPreview, PostmanImportDiagnostic } from '../../models/PostmanImport';
import { isJustRequest, PROTOCOL_LIMITS, validateCollectionImportDocument } from '../../protocol/MessageValidator';
import { isCredentialHeader, isCredentialPlaceholder } from '../auth/CredentialRedaction';
import { normalizeEffectiveRequest } from '../http/EffectiveRequest';
import { ApplicationError } from '../../services/ApplicationError';

type ObjectValue = Record<string, unknown>;
export interface ParsedPostmanImport {
  preview: Omit<PostmanImportPreview, 'previewId' | 'fileName'>;
  document?: CollectionTransferDocument;
  environment?: Variable[];
  authInputs: Map<string, AuthInput>;
}
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value: unknown, maximum = 65536): string {
  if (value === undefined || value === null) { return ''; }
  if (!['string', 'number', 'boolean'].includes(typeof value)) { throw new Error('Invalid scalar'); }
  const result = String(value); if (result.length > maximum) { throw new Error('Scalar too large'); } return result;
}
function list(value: unknown, maximum = 1000): unknown[] {
  if (value === undefined) { return []; }
  if (!Array.isArray(value) || value.length > maximum) { throw new Error('Invalid list'); } return value;
}
function flag(value: unknown): boolean {
  if (value !== undefined && typeof value !== 'boolean') { throw new Error('Invalid flag'); } return value === true;
}

/** Converts a bounded offline export; never evaluates scripts, follows links or opens body files. */
export function parsePostmanExport(source: string): ParsedPostmanImport {
  try { return convert(source); }
  catch (error) {
    if (error instanceof ApplicationError) { throw error; }
    throw new ApplicationError('IMPORT_ERROR', ['Select a valid Postman v2.1 collection or environment JSON export within the supported limits.']);
  }
}
function convert(source: string): ParsedPostmanImport {
  if (Buffer.byteLength(source, 'utf8') > PROTOCOL_LIMITS.importMessageBytes) { throw new Error('Source too large'); }
  const root: unknown = JSON.parse(source.replace(/^\uFEFF/, ''));
  let nodes = 0;
  const inspect = (value: unknown, depth: number): void => {
    if (++nodes > 100000 || depth > 110) { throw new Error('Structure too large'); }
    if (object(value)) { Object.values(value).forEach(child => inspect(child, depth + 1)); }
    else if (Array.isArray(value)) { value.forEach(child => inspect(child, depth + 1)); }
  };
  inspect(root, 0); if (!object(root)) { throw new Error('Invalid root'); }
  const environment = root._postman_variable_scope === 'environment';
  if (!environment && (!object(root.info) || typeof root.info.schema !== 'string'
    || !/^https?:\/\/(?:schema\.getpostman\.com\/json\/collection\/v2\.1\.0\/collection\.json|schema\.postman\.com\/collection\/json\/v2\.1\.0\/(?:draft-07\/)?collection\.json)$/.test(root.info.schema)
    || !Array.isArray(root.item))) { throw new Error('Unsupported format'); }
  const name = text(environment ? root.name : (root.info as ObjectValue).name, 1024).trim();
  if (!name) { throw new Error('Missing name'); }
  const result: ParsedPostmanImport = { authInputs: new Map(), preview: { name, kind: environment ? 'environment' : 'collection',
    requests: 0, folders: 0, variables: 0, credentials: 0, skippedRequests: 0, skippedVariables: 0, diagnosticCount: 0, diagnostics: [] } };
  const warn = (code: PostmanImportDiagnostic['code'], location: string) => {
    result.preview.diagnosticCount++;
    if (result.preview.diagnostics.length < 200) { result.preview.diagnostics.push({ code, location }); }
  };
  const variables = (value: unknown, location: string, scope: Variable['scope']): Variable[] => {
    const keys = new Set<string>(); const parsed: Variable[] = [];
    list(value).forEach((entry, index) => {
      const path = `${location}[${index}]`;
      try {
        if (!object(entry)) { throw new Error(); }
        if (entry.type === 'secret') { result.preview.skippedVariables++; warn('SECRET_VARIABLE_SKIPPED', path); return; }
        const key = text(entry.key, 128);
        if (!/^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$/.test(key) || keys.has(key)) { throw new Error(); }
        if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') { throw new Error(); }
        const enabled = entry.enabled === undefined ? !flag(entry.disabled) : entry.enabled;
        parsed.push({ id: randomUUID(), key, value: text(entry.value), enabled, scope }); keys.add(key);
      } catch { result.preview.skippedVariables++; warn('VARIABLE_SKIPPED', path); }
    }); return parsed;
  };
  if (environment) {
    if (!Array.isArray(root.values)) { throw new Error('Missing values'); }
    result.environment = variables(root.values, 'values', 'collection'); result.preview.variables = result.environment.length;
    return result;
  }
  const collection = createDefaultCollection(name, randomUUID());
  const info = root.info as ObjectValue;
  if (typeof info.description === 'string') { collection.description = info.description; }
  else if (object(info.description) && typeof info.description.content === 'string') { collection.description = info.description.content; }
  collection.variables = variables(root.variable, 'variable', 'collection'); result.preview.variables = collection.variables.length;
  if (collection.variables.length) { warn('VARIABLE_PRECEDENCE', 'variable'); }
  const requests: JustRequest[] = [];
  let convertedBytes = Buffer.byteLength(JSON.stringify(collection));
  let convertedVariables = collection.variables.length;
  const metadata = (entry: ObjectValue, path: string) => {
    if (list(entry.event).length) { warn('SCRIPTS_OMITTED', `${path}.event`); }
    if (entry.protocolProfileBehavior !== undefined || entry.proxy !== undefined || entry.certificate !== undefined) { warn('SETTINGS_OMITTED', `${path}.protocolProfileBehavior`); }
  };
  metadata(root, 'collection'); let itemCount = 0;
  const visit = (entries: unknown[], inheritedAuth: unknown, inheritedVars: Variable[], path: string, depth: number): CollectionItemRef[] => {
    if (depth > 50) { throw new Error('Folders too deep'); }
    const items: CollectionItemRef[] = [];
    entries.forEach((entry, index) => {
      if (++itemCount > 10000) { throw new Error('Too many items'); }
      const location = `${path}[${index}]`;
      if (!object(entry)) { throw new Error('Invalid item'); }
      metadata(entry, location);
      const auth = entry.auth ?? inheritedAuth;
      if (Array.isArray(entry.item) && entry.request === undefined) {
        const folderVars = variables(entry.variable, `${location}.variable`, 'request');
        if (folderVars.length) { warn('VARIABLE_PRECEDENCE', `${location}.variable`); }
        const merged = [...inheritedVars.filter(old => !folderVars.some(variable => variable.key === old.key)), ...folderVars];
        const name = text(entry.name, 1024) || 'Imported folder';
        items.push({ id: randomUUID(), name, type: 'folder', items: visit(entry.item, auth, merged, `${location}.item`, depth + 1) });
        result.preview.folders++; return;
      }
      try {
        const sourceRequest = typeof entry.request === 'string' ? { url: entry.request, method: 'GET' } : entry.request;
        if (!object(sourceRequest)) { throw new Error(); }
        metadata(sourceRequest, `${location}.request`);
        if (list(entry.response).length) { warn('EXAMPLES_OMITTED', `${location}.response`); }
        if (sourceRequest.description !== undefined) { warn('DESCRIPTION_OMITTED', `${location}.request.description`); }
        if (sourceRequest.cookie !== undefined) { warn('COOKIES_OMITTED', `${location}.request.cookie`); }
        const request = createDefaultRequest(randomUUID()); request.name = text(entry.name, 1024) || 'Imported request';
        const method = text(sourceRequest.method || 'GET');
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(method)) { throw new Error(); }
        request.method = method as HttpMethod;
        request.variables = inheritedVars.map(variable => ({ ...variable, id: randomUUID() }));
        request.headers = pairs(sourceRequest.header);
        readUrl(sourceRequest.url, request); readBody(sourceRequest.body, request);
        const input = readAuth(sourceRequest.auth ?? auth);
        if (input.type !== 'none') {
          const credential = input.type === 'bearer' ? input.token : input.type === 'basic' ? input.password : input.value;
          if (isCredentialPlaceholder(credential) || (input.type === 'basic' && isCredentialPlaceholder(input.username))) { warn('AUTH_PLACEHOLDER', `${location}.request.auth`); }
          else {
            const query = input.type === 'apiKey' && input.in === 'query';
            const key = input.type === 'apiKey' ? input.name : 'Authorization';
            if (query && new URLSearchParams(request.url.split('?')[1]?.split('#')[0] ?? '').has(key)) { throw new Error(); }
            if ((query ? request.queryParams : request.headers).some(pair => pair.enabled && (query ? pair.key === key : pair.key.toLowerCase() === key.toLowerCase()))) { throw new Error(); }
            result.authInputs.set(request.id, input);
          }
        }
        migrateHeaderAuth(request, result.authInputs, () => warn('AUTH_PLACEHOLDER', location + '.request.header'));
        migrateUrlAuth(request, result.authInputs, () => warn('AUTH_PLACEHOLDER', location + '.request.url'));
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(request.url) && !/^https?:/.test(request.url)) { throw new Error(); }
        if (!isJustRequest(request) || !request.url) { throw new Error(); }
        if (!JSON.stringify(request).includes('{{')) { normalizeEffectiveRequest(request); }
        convertedVariables += request.variables.length;
        convertedBytes += Buffer.byteLength(JSON.stringify(request)) + Buffer.byteLength(JSON.stringify(result.authInputs.get(request.id) ?? {}));
        if (convertedVariables > 10000 || convertedBytes > PROTOCOL_LIMITS.importMessageBytes) {
          throw new ApplicationError('IMPORT_ERROR', ['The converted collection exceeds the local import limits. Split the source collection before importing.']);
        }
        requests.push(request); items.push({ id: randomUUID(), name: request.name, type: 'request', requestId: request.id });
      } catch (error) { if (error instanceof ApplicationError) { throw error; } result.preview.skippedRequests++; warn('REQUEST_SKIPPED', `${location}.request`); }
    }); return items;
  };
  collection.items = visit(root.item as unknown[], root.auth, [], 'item', 0);
  const document: CollectionTransferDocument = { schemaVersion: 2, collection, requests };
  if (!validateCollectionImportDocument(JSON.stringify(document)).ok) { throw new Error('Converted document exceeds limits'); }
  const requestIds = new Set(requests.map(request => request.id));
  for (const id of result.authInputs.keys()) { if (!requestIds.has(id)) { result.authInputs.delete(id); } }
  result.document = document; result.preview.requests = requests.length;
  result.preview.credentials = requests.filter(request => result.authInputs.has(request.id) || request.headers.some(header => header.enabled && /^(authorization|x-api-key|api-key)$/i.test(header.key) && !isCredentialPlaceholder(header.value))).length;
  result.preview.variables += requests.reduce((count, request) => count + request.variables.length, 0);
  return result;
}
function pairs(value: unknown): KeyValuePair[] {
  return list(value, 200).map(entry => {
    if (!object(entry) || typeof entry.key !== 'string') { throw new Error(); }
    return { id: randomUUID(), key: text(entry.key, 1024), value: text(entry.value), enabled: !flag(entry.disabled) };
  });
}
function readUrl(value: unknown, request: JustRequest): void {
  if (typeof value === 'string') { request.url = text(value, 16384); return; }
  if (!object(value)) { throw new Error(); }
  let raw = typeof value.raw === 'string' ? value.raw : '';
  if (!raw) {
    const host = Array.isArray(value.host) ? value.host.map(part => text(part)).join('.') : text(value.host);
    const path = Array.isArray(value.path) ? value.path.map(part => object(part) ? text(part.value) : text(part)).join('/') : text(value.path);
    if (!host) { throw new Error(); }
    raw = `${text(value.protocol) || 'http'}://${host}${value.port ? ':' + text(value.port) : ''}/${path.replace(/^\//, '')}`;
    if (value.hash) { raw += '#' + text(value.hash); }
  }
  request.url = text(raw, 16384);
  if (value.query !== undefined) {
    request.queryParams = pairs(value.query);
    const hash = raw.indexOf('#'); const query = raw.indexOf('?');
    if (query >= 0 && (hash < 0 || query < hash)) { request.url = raw.slice(0, query) + (hash >= 0 ? raw.slice(hash) : ''); }
  }
  request.pathParams = list(value.variable, 200).map(entry => {
    if (!object(entry) || flag(entry.disabled)) { throw new Error(); }
    return { id: randomUUID(), name: text(entry.key, 128), value: text(entry.value) };
  });
}
function readBody(value: unknown, request: JustRequest): void {
  if (value === undefined || value === null) { return; }
  if (!object(value)) { throw new Error(); }
  if (flag(value.disabled)) { return; }
  if (value.mode === 'raw') {
    const options = object(value.options) && object(value.options.raw) ? value.options.raw : {};
    const language = text(options.language);
    request.body = { type: language === 'json' ? 'json' : language === 'xml' ? 'xml' : 'text', content: text(value.raw, 10 * 1024 * 1024) };
  } else if (value.mode === 'urlencoded') { request.body = { type: 'x-www-form-urlencoded', content: '', formData: pairs(value.urlencoded) }; }
  else if (value.mode === 'formdata') {
    const entries = list(value.formdata, 200);
    if (entries.some(entry => !object(entry) || (!flag(entry.disabled) && (entry.type === 'file' || entry.src !== undefined || entry.contentType !== undefined)))) { throw new Error(); }
    request.body = { type: 'form-data', content: '', formData: pairs(entries) };
  } else if (value.mode !== undefined || Object.keys(value).length > 0) { throw new Error(); }
}
function readAuth(value: unknown): AuthInput {
  if (value === undefined || value === null) { return { type: 'none' }; }
  if (!object(value)) { throw new Error(); }
  if (value.type === 'noauth') { return { type: 'none' }; }
  if (!['bearer', 'basic', 'apikey'].includes(String(value.type))) { throw new Error(); }
  const entries = list(value[String(value.type)], 100); const fields = new Map<string, string>();
  entries.forEach(entry => {
    if (!object(entry) || typeof entry.key !== 'string' || fields.has(entry.key)) { throw new Error(); }
    fields.set(entry.key, text(entry.value));
  });
  if (value.type === 'basic') { return { type: 'basic', username: fields.get('username') ?? '', password: fields.get('password') ?? '' }; }
  if (value.type === 'bearer') { const token = fields.get('token'); if (!token) { throw new Error(); } return { type: 'bearer', token }; }
  const name = fields.get('key'); const secret = fields.get('value'); const location = fields.get('in') ?? 'header';
  if (!name || name.length > 1024 || !secret || !['header', 'query'].includes(location)) { throw new Error(); }
  return { type: 'apiKey', name, value: secret, in: location as 'header' | 'query' };
}
function migrateUrlAuth(request: JustRequest, inputs: Map<string, AuthInput>, placeholder: () => void): void {
  // Share the authority boundary with derivative redaction, including variable protocols and draft URLs.
  const safe = redactUrlUserInfo(request.url);
  if (!safe.redacted) { return; }
  const authority = /^(\s*(?:https?:[/\\]*|(?:[^\s/\\?#]+:)?[/\\]{2}))([^/\\?#]*)/i.exec(request.url);
  if (!authority || inputs.has(request.id) || request.headers.some(header => header.enabled && /^authorization$/i.test(header.key))) { throw new Error(); }
  const userinfo = authority[2].slice(0, authority[2].lastIndexOf('@')); const separator = userinfo.indexOf(':');
  const username = decodeURIComponent(separator < 0 ? userinfo : userinfo.slice(0, separator));
  const password = decodeURIComponent(separator < 0 ? '' : userinfo.slice(separator + 1));
  request.url = safe.value;
  if (isCredentialPlaceholder(password) || isCredentialPlaceholder(username)) { placeholder(); }
  else { inputs.set(request.id, { type: 'basic', username, password }); }
}

function migrateHeaderAuth(request: JustRequest, inputs: Map<string, AuthInput>, placeholder: () => void): void {
  const recognized = request.headers.filter(header => isCredentialHeader(header.key));
  for (const header of recognized) {
    if (isCredentialPlaceholder(header.value)) { request.headers.splice(request.headers.indexOf(header), 1); placeholder(); continue; }
    // The auth model represents one credential. Exclude ambiguous combinations rather than persist extra secrets in headers.
    if (!header.enabled || inputs.has(request.id)) { throw new Error(); }
    const bearer = /^Bearer\s+(.+)$/i.exec(header.value); const basic = /^Basic\s+([^\s]+)$/i.exec(header.value);
    let input: AuthInput;
    if (/^(x-api-key|api-key)$/i.test(header.key) && header.value) { input = { type: 'apiKey', name: header.key, in: 'header', value: header.value }; }
    else if (/^authorization$/i.test(header.key) && bearer) { input = { type: 'bearer', token: bearer[1] }; }
    else if (/^authorization$/i.test(header.key) && basic) {
      const bytes = Buffer.from(basic[1], 'base64');
      if (bytes.toString('base64').replace(/=+$/, '') !== basic[1].replace(/=+$/, '')) { throw new Error(); }
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); const colon = decoded.indexOf(':');
      if (colon < 0) { throw new Error(); } input = { type: 'basic', username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
    } else { throw new Error(); }
    inputs.set(request.id, input); request.headers.splice(request.headers.indexOf(header), 1);
  }
}
