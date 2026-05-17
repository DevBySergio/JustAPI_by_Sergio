import { KeyValuePair, PathParam } from './KeyValuePair';
import { Variable } from './Variable';

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
  pathParams: PathParam[];
  body: RequestBody;
  settings: RequestSettings;
  variables: Variable[];
  created: number;
  updated: number;
}

export function createDefaultRequest(): JustRequest {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: 'New Request',
    method: 'GET',
    url: '',
    headers: [],
    queryParams: [],
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
