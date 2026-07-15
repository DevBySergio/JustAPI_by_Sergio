import { KeyValuePair, PathParam } from './KeyValuePair';
import { Variable } from './Variable';
import { AuthConfig, PersistedAuthConfig } from './Auth';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export type BodyType = 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'text' | 'xml' | 'binary';

export interface RequestBody {
  type: BodyType;
  content: string;
  formData?: KeyValuePair[];
}

export interface RequestSettings {
  timeout: number;
  followRedirects: boolean;
  verifySSL: boolean;
  maxResponseBytes: number;
}

export const RESPONSE_SIZE_LIMITS = {
  minimum: 1024,
  default: 10 * 1024 * 1024,
  maximum: 100 * 1024 * 1024,
} as const;

export function normalizeRequestSettings(settings?: Partial<RequestSettings>): RequestSettings {
  const timeout = settings?.timeout;
  const maxResponseBytes = settings?.maxResponseBytes;
  return {
    timeout: Number.isInteger(timeout) && timeout !== undefined && timeout >= 1 && timeout <= 600_000
      ? timeout
      : 30_000,
    followRedirects: typeof settings?.followRedirects === 'boolean'
      ? settings.followRedirects
      : true,
    verifySSL: typeof settings?.verifySSL === 'boolean'
      ? settings.verifySSL
      : true,
    maxResponseBytes: Number.isInteger(maxResponseBytes)
      && maxResponseBytes !== undefined
      && maxResponseBytes >= RESPONSE_SIZE_LIMITS.minimum
      && maxResponseBytes <= RESPONSE_SIZE_LIMITS.maximum
      ? maxResponseBytes
      : RESPONSE_SIZE_LIMITS.default,
  };
}

export interface JustRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValuePair[];
  queryParams: KeyValuePair[];
  auth: AuthConfig;
  pathParams: PathParam[];
  body: RequestBody;
  settings: RequestSettings;
  variables: Variable[];
  created: number;
  updated: number;
}

export type PersistedJustRequest = Omit<JustRequest, 'auth'> & {
  auth: PersistedAuthConfig;
};

export function createDefaultRequest(): JustRequest {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: 'New Request',
    method: 'GET',
    url: '',
    headers: [],
    queryParams: [],
    auth: { type: 'none' },
    pathParams: [],
    body: { type: 'none', content: '' },
    settings: normalizeRequestSettings(),
    variables: [],
    created: now,
    updated: now,
  };
}
