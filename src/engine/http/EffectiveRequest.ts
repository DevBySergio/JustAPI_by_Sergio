import { validateHeaderName, validateHeaderValue } from 'node:http';
import type { AuthConfig } from '../../models/Auth';
import type { HttpMethod, JustRequest, RequestSettings } from '../../models/Request';
import { normalizeRequestSettings } from '../../models/Request';

const MAX_URL_LENGTH = 16 * 1024;
const BODY_MANAGED_HEADERS = new Set(['content-length', 'transfer-encoding']);

export type CredentialRepresentation = 'none' | 'placeholder' | 'resolved';

export interface EffectiveRequestField {
  name: string;
  value: string;
}

export interface EffectiveRequestHeader extends EffectiveRequestField {}

export type EffectiveRequestBody =
  | { type: 'none'; content: ''; fields: []; contentType?: undefined }
  | {
      type: 'form-data';
      content: '';
      fields: EffectiveRequestField[];
      contentType: 'multipart/form-data';
    }
  | {
      type: 'x-www-form-urlencoded';
      content: '';
      fields: EffectiveRequestField[];
      contentType: 'application/x-www-form-urlencoded';
    }
  | {
      type: 'json' | 'text' | 'xml' | 'binary';
      content: string;
      fields: [];
      contentType: string;
    };

export interface EffectiveRequestAuth {
  type: AuthConfig['type'];
  representation: CredentialRepresentation;
}

export interface EffectiveRequest {
  method: HttpMethod;
  url: string;
  headers: EffectiveRequestHeader[];
  body: EffectiveRequestBody;
  settings: RequestSettings;
  auth: EffectiveRequestAuth;
}

export type EffectiveRequestErrorCode = 'INVALID_URL' | 'INVALID_HEADER';

export class EffectiveRequestError extends Error {
  constructor(readonly code: EffectiveRequestErrorCode, message: string) {
    super(message);
    this.name = 'EffectiveRequestError';
  }
}

export interface EffectiveRequestOptions {
  credentialRepresentation?: CredentialRepresentation;
}

export function normalizeEffectiveRequest(
  request: JustRequest,
  options: EffectiveRequestOptions = {}
): EffectiveRequest {
  const body = normalizeBody(request);
  return {
    method: request.method,
    url: normalizeUrl(request),
    headers: normalizeHeaders(request, body),
    body,
    settings: normalizeRequestSettings(request.settings),
    auth: {
      type: request.auth.type,
      representation: request.auth.type === 'none'
        && options.credentialRepresentation === undefined
        ? 'none'
        : options.credentialRepresentation ?? 'placeholder',
    },
  };
}

export function encodeFormFields(fields: readonly EffectiveRequestField[]): string {
  const encoded = new URLSearchParams();
  for (const field of fields) {
    encoded.append(field.name, field.value);
  }
  return encoded.toString();
}

function normalizeUrl(request: JustRequest): string {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new EffectiveRequestError('INVALID_URL', 'The request URL is invalid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EffectiveRequestError(
      'INVALID_URL',
      'The request URL must use the HTTP or HTTPS protocol.'
    );
  }
  for (const parameter of request.queryParams) {
    if (parameter.enabled && parameter.key) {
      url.searchParams.append(parameter.key, parameter.value);
    }
  }
  url.hash = '';
  const serialized = url.toString();
  if (serialized.length > MAX_URL_LENGTH) {
    throw new EffectiveRequestError('INVALID_URL', 'The request URL exceeds the supported size.');
  }
  try {
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch {
    throw new EffectiveRequestError('INVALID_URL', 'The request URL contains invalid credentials.');
  }
  return serialized;
}

function normalizeBody(request: JustRequest): EffectiveRequestBody {
  const fields = (request.body.formData ?? [])
    .filter(field => field.enabled && field.key)
    .map(field => ({ name: field.key, value: field.value }));
  switch (request.body.type) {
    case 'none':
      return { type: 'none', content: '', fields: [] };
    case 'form-data':
      return { type: 'form-data', content: '', fields, contentType: 'multipart/form-data' };
    case 'x-www-form-urlencoded':
      return {
        type: 'x-www-form-urlencoded',
        content: '',
        fields,
        contentType: 'application/x-www-form-urlencoded',
      };
    case 'json':
      return {
        type: 'json',
        content: request.body.content,
        fields: [],
        contentType: 'application/json; charset=utf-8',
      };
    case 'xml':
      return {
        type: 'xml',
        content: request.body.content,
        fields: [],
        contentType: 'application/xml; charset=utf-8',
      };
    case 'text':
      return {
        type: 'text',
        content: request.body.content,
        fields: [],
        contentType: 'text/plain; charset=utf-8',
      };
    case 'binary':
      return {
        type: 'binary',
        content: request.body.content,
        fields: [],
        contentType: 'application/octet-stream',
      };
  }
}

function normalizeHeaders(
  request: JustRequest,
  body: EffectiveRequestBody
): EffectiveRequestHeader[] {
  const headers = new Map<string, EffectiveRequestHeader>();
  for (const header of request.headers) {
    if (!header.enabled || !header.key) {
      continue;
    }
    try {
      validateHeaderName(header.key);
      validateHeaderValue(header.key, header.value);
    } catch {
      throw new EffectiveRequestError('INVALID_HEADER', 'An enabled request header is invalid.');
    }
    headers.set(header.key.toLowerCase(), { name: header.key, value: header.value });
  }

  for (const name of BODY_MANAGED_HEADERS) {
    headers.delete(name);
  }
  if (body.type === 'form-data') {
    // Each target runtime creates its own multipart boundary and matching Content-Type.
    headers.delete('content-type');
  } else if (body.type !== 'none' && !headers.has('content-type')) {
    headers.set('content-type', { name: 'Content-Type', value: body.contentType });
  }
  return Array.from(headers.values());
}
