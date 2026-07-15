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
    settings: {
      timeout: 30000,
      followRedirects: true,
      verifySSL: true,
    },
    variables: [],
    created: now,
    updated: now,
  };
}
