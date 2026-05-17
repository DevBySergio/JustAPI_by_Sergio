export type BodyType = 'json' | 'html' | 'xml' | 'text' | 'image' | 'binary' | 'unknown';

export interface ResponseCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
}

export interface RequestError {
  type: 'network' | 'timeout' | 'dns' | 'ssl' | 'invalid-response' | 'aborted' | 'unknown';
  message: string;
}

export interface JustResponse {
  statusCode: number;
  statusText: string;
  httpVersion: string;
  headers: Record<string, string>;
  body: string;
  bodyType: BodyType;
  size: number;
  duration: number;
  cookies: ResponseCookie[];
  error?: RequestError;
  redirected: boolean;
  finalUrl?: string;
}
