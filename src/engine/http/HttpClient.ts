import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import { TextDecoder } from 'node:util';
import { brotliDecompress, gunzip, inflate, ZlibOptions } from 'node:zlib';
import { KeyValuePair } from '../../models/KeyValuePair';
import {
  BodyType,
  JustRequest,
  normalizeRequestSettings,
  RequestBody,
  RequestSettings,
} from '../../models/Request';
import {
  BodyType as ResponseBodyType,
  JustResponse,
  RequestError,
  ResponseCookie,
  ResponseTimings,
} from '../../models/Response';

const DEFAULT_MAX_REDIRECTS = 10;
const MAX_URL_LENGTH = 16 * 1024;
const MAX_RESPONSE_HEADERS = 200;
const MAX_HEADER_NAME_LENGTH = 1024;
const MAX_HEADER_VALUE_LENGTH = 64 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BODY_HEADER_NAMES = ['content-length', 'content-type', 'transfer-encoding'];
const ALWAYS_SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'cookie2',
  'x-api-key',
  'api-key',
]);

type LookupFunction = NonNullable<http.RequestOptions['lookup']>;
type Decompressor = (
  buffer: Buffer,
  options: ZlibOptions,
  callback: (error: Error | null, result: Buffer) => void
) => void;

export interface HttpClientOptions {
  maxRedirects?: number;
  boundaryFactory?: () => string;
  lookup?: LookupFunction;
}

interface BodyPayload {
  bytes?: Buffer;
  contentType?: string;
  forceContentType?: boolean;
}

interface TimingAccumulator {
  dns: number;
  dnsObserved: boolean;
  connect: number;
  connectObserved: boolean;
  tls: number;
  tlsObserved: boolean;
  firstByte?: number;
  download?: number;
}

interface ExecutionState {
  controller: AbortController;
  cancelled: boolean;
  timedOut: boolean;
  startedAt: number;
  redirects: number;
  timings: TimingAccumulator;
}

type HopResult =
  | { kind: 'redirect'; statusCode: number; location: string }
  | { kind: 'response'; response: JustResponse }
  | { kind: 'error'; error: RequestError };

interface DecodedBody {
  body: string;
  bodyType: ResponseBodyType;
  bytes: Buffer;
  mimeType?: string;
}

class TransportFailure extends Error {
  constructor(readonly requestError: RequestError) {
    super(requestError.message);
    this.name = 'TransportFailure';
  }
}

function boundedDecompress(
  decompressor: Decompressor,
  input: Buffer,
  maximumBytes: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    decompressor(input, { maxOutputLength: maximumBytes }, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

export class HttpClient {
  private activeExecution: ExecutionState | null = null;
  private readonly maxRedirects: number;
  private readonly boundaryFactory: () => string;
  private readonly lookup?: LookupFunction;

  constructor(options: HttpClientOptions = {}) {
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 100) {
      throw new Error('The redirect limit must be an integer between 0 and 100.');
    }
    this.maxRedirects = maxRedirects;
    this.boundaryFactory = options.boundaryFactory
      ?? (() => `----JustAPIBoundary${randomUUID().replace(/-/g, '')}`);
    this.lookup = options.lookup;
  }

  cancel(): void {
    const execution = this.activeExecution;
    if (execution && !execution.controller.signal.aborted) {
      execution.cancelled = true;
      execution.controller.abort();
    }
  }

  async execute(request: JustRequest): Promise<JustResponse> {
    if (this.activeExecution) {
      const state = this.createExecutionState();
      return this.errorResponse(state, {
        type: 'invalid-response',
        message: 'This HTTP execution is already active.',
      });
    }

    const state = this.createExecutionState();
    this.activeExecution = state;
    const settings = normalizeRequestSettings(request.settings);
    const timeout = setTimeout(() => {
      if (!state.controller.signal.aborted) {
        state.timedOut = true;
        state.controller.abort();
      }
    }, settings.timeout);

    let currentUrl: URL | undefined;
    try {
      currentUrl = this.buildUrl(request.url, request.queryParams);
      const payload = this.buildBody(request.body);
      let method = request.method;
      let body = payload.bytes;
      let headers = this.buildHeaders(request.headers, payload);
      const sensitiveHeaders = this.sensitiveHeaderNames(request);

      while (true) {
        const result = await this.executeHop(
          currentUrl,
          method,
          headers,
          body,
          settings,
          state,
          request
        );
        if (result.kind === 'response') {
          return result.response;
        }
        if (result.kind === 'error') {
          return this.errorResponse(state, result.error, currentUrl, request);
        }
        if (state.redirects >= this.maxRedirects) {
          return this.errorResponse(state, {
            type: 'redirect',
            message: `The response exceeded the ${this.maxRedirects}-hop redirect limit.`,
          }, currentUrl, request);
        }

        let nextUrl: URL;
        try {
          nextUrl = new URL(result.location, currentUrl);
          this.assertSupportedUrl(nextUrl, 'redirect');
        } catch {
          return this.errorResponse(state, {
            type: 'redirect',
            message: 'The server returned an invalid redirect location.',
          }, currentUrl, request);
        }

        const transition = this.redirectTransition(result.statusCode, method);
        if (transition.dropBody) {
          body = undefined;
          headers = this.withoutHeaders(headers, BODY_HEADER_NAMES);
        }
        method = transition.method;
        if (currentUrl.origin !== nextUrl.origin) {
          headers = this.withoutHeaders(headers, [...sensitiveHeaders, 'host']);
          nextUrl.username = '';
          nextUrl.password = '';
        }
        state.redirects += 1;
        currentUrl = nextUrl;
      }
    } catch (error) {
      const requestError = error instanceof TransportFailure
        ? error.requestError
        : this.classifyNodeError(error, state);
      return this.errorResponse(state, requestError, currentUrl, request);
    } finally {
      clearTimeout(timeout);
      if (this.activeExecution === state) {
        this.activeExecution = null;
      }
    }
  }

  private createExecutionState(): ExecutionState {
    return {
      controller: new AbortController(),
      cancelled: false,
      timedOut: false,
      startedAt: performance.now(),
      redirects: 0,
      timings: {
        dns: 0,
        dnsObserved: false,
        connect: 0,
        connectObserved: false,
        tls: 0,
        tlsObserved: false,
      },
    };
  }

  private buildUrl(baseUrl: string, queryParams: KeyValuePair[]): URL {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new TransportFailure({
        type: 'invalid-url',
        message: 'The request URL is invalid.',
      });
    }
    this.assertSupportedUrl(url, 'request');
    for (const parameter of queryParams) {
      if (parameter.enabled && parameter.key) {
        url.searchParams.append(parameter.key, parameter.value);
      }
    }
    url.hash = '';
    this.assertSupportedUrl(url, 'request');
    return url;
  }

  private assertSupportedUrl(url: URL, kind: 'request' | 'redirect'): void {
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.toString().length > MAX_URL_LENGTH) {
      throw new TransportFailure({
        type: kind === 'redirect' ? 'redirect' : 'invalid-url',
        message: kind === 'redirect'
          ? 'The server returned an invalid redirect location.'
          : 'The request URL must be a bounded HTTP or HTTPS URL.',
      });
    }
    try {
      decodeURIComponent(url.username);
      decodeURIComponent(url.password);
    } catch {
      throw new TransportFailure({
        type: kind === 'redirect' ? 'redirect' : 'invalid-url',
        message: kind === 'redirect'
          ? 'The server returned an invalid redirect location.'
          : 'The request URL contains invalid credentials.',
      });
    }
  }

  private buildBody(requestBody: RequestBody): BodyPayload {
    switch (requestBody.type) {
      case 'none':
        return {};
      case 'form-data': {
        const boundary = this.boundaryFactory();
        if (!/^[A-Za-z0-9'()+_,./:=?-]{1,70}$/.test(boundary)) {
          throw new TransportFailure({
            type: 'invalid-response',
            message: 'The multipart boundary is invalid.',
          });
        }
        const chunks: Buffer[] = [];
        for (const field of requestBody.formData || []) {
          if (!field.enabled || !field.key) { continue; }
          const name = field.key
            .replace(/\r|\n/g, ' ')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
          chunks.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${field.value}\r\n`,
            'utf8'
          ));
        }
        chunks.push(Buffer.from(`--${boundary}--\r\n`, 'ascii'));
        return {
          bytes: Buffer.concat(chunks),
          contentType: `multipart/form-data; boundary=${boundary}`,
          forceContentType: true,
        };
      }
      case 'x-www-form-urlencoded': {
        const fields = new URLSearchParams();
        for (const field of requestBody.formData || []) {
          if (field.enabled && field.key) {
            fields.append(field.key, field.value);
          }
        }
        return {
          bytes: Buffer.from(fields.toString(), 'utf8'),
          contentType: 'application/x-www-form-urlencoded',
        };
      }
      default:
        return {
          bytes: Buffer.from(requestBody.content, 'utf8'),
          contentType: this.defaultContentType(requestBody.type),
        };
    }
  }

  private defaultContentType(type: Exclude<BodyType, 'none' | 'form-data' | 'x-www-form-urlencoded'>): string {
    switch (type) {
      case 'json': return 'application/json; charset=utf-8';
      case 'xml': return 'application/xml; charset=utf-8';
      case 'text': return 'text/plain; charset=utf-8';
      case 'binary': return 'application/octet-stream';
    }
  }

  private buildHeaders(headers: KeyValuePair[], payload: BodyPayload): Record<string, string> {
    const normalized = new Map<string, { name: string; value: string }>();
    for (const header of headers) {
      if (!header.enabled || !header.key) { continue; }
      try {
        http.validateHeaderName(header.key);
        http.validateHeaderValue(header.key, header.value);
      } catch {
        throw new TransportFailure({
          type: 'invalid-response',
          message: 'An enabled request header is invalid.',
        });
      }
      normalized.set(header.key.toLowerCase(), { name: header.key, value: header.value });
    }

    const result = Object.fromEntries(Array.from(normalized.values()).map(header => [header.name, header.value]));
    if (payload.bytes === undefined) {
      return this.withoutHeaders(result, ['content-length', 'transfer-encoding']);
    }
    if (payload.contentType
      && (payload.forceContentType || this.headerValue(result, 'content-type') === undefined)) {
      this.setHeader(result, 'Content-Type', payload.contentType);
    }
    this.setHeader(result, 'Content-Length', String(payload.bytes.length));
    return this.withoutHeaders(result, ['transfer-encoding']);
  }

  private setHeader(headers: Record<string, string>, name: string, value: string): void {
    const lowerName = name.toLowerCase();
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === lowerName) {
        delete headers[existing];
      }
    }
    headers[name] = value;
  }

  private withoutHeaders(headers: Record<string, string>, names: readonly string[]): Record<string, string> {
    const removed = new Set(names.map(name => name.toLowerCase()));
    return Object.fromEntries(Object.entries(headers).filter(([name]) => !removed.has(name.toLowerCase())));
  }

  private sensitiveHeaderNames(request: JustRequest): Set<string> {
    const names = new Set(ALWAYS_SENSITIVE_HEADERS);
    if (request.auth.type === 'apiKey' && request.auth.in === 'header') {
      names.add(request.auth.name.toLowerCase());
    }
    return names;
  }

  private redirectTransition(
    statusCode: number,
    method: JustRequest['method']
  ): { method: JustRequest['method']; dropBody: boolean } {
    if (statusCode === 303) {
      return { method: method === 'HEAD' ? 'HEAD' : 'GET', dropBody: true };
    }
    if ((statusCode === 301 || statusCode === 302) && method === 'POST') {
      return { method: 'GET', dropBody: true };
    }
    return { method, dropBody: false };
  }

  private executeHop(
    url: URL,
    method: JustRequest['method'],
    headers: Record<string, string>,
    body: Buffer | undefined,
    settings: RequestSettings,
    state: ExecutionState,
    sourceRequest: JustRequest
  ): Promise<HopResult> {
    const isHttps = url.protocol === 'https:';
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      rejectUnauthorized: settings.verifySSL,
      signal: state.controller.signal,
      maxHeaderSize: MAX_HEADER_BYTES,
      ...(this.lookup ? { lookup: this.lookup } : {}),
      ...((url.username || url.password) ? {
        auth: `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
      } : {}),
    };
    const transport = isHttps ? https : http;

    return new Promise(resolve => {
      let settled = false;
      const finish = (result: HopResult): void => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      let request: http.ClientRequest;
      try {
        request = transport.request(options, response => {
          const responseAt = performance.now();
          const statusCode = response.statusCode ?? 0;
          const location = response.headers.location;
          if (settings.followRedirects
            && REDIRECT_STATUSES.has(statusCode)
            && typeof location === 'string') {
            response.resume();
            finish({ kind: 'redirect', statusCode, location });
            return;
          }

          state.timings.firstByte = responseAt - state.startedAt;
          const declaredLength = this.declaredContentLength(response.headers['content-length']);
          if (declaredLength !== undefined && declaredLength > settings.maxResponseBytes) {
            finish({ kind: 'error', error: this.responseTooLargeError(settings.maxResponseBytes) });
            response.destroy();
            return;
          }

          const chunks: Buffer[] = [];
          let receivedBytes = 0;
          response.on('data', (chunk: Buffer) => {
            if (settled) { return; }
            receivedBytes += chunk.length;
            if (receivedBytes > settings.maxResponseBytes) {
              finish({ kind: 'error', error: this.responseTooLargeError(settings.maxResponseBytes) });
              response.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.once('aborted', () => {
            finish({ kind: 'error', error: this.classifyNodeError(undefined, state, true) });
          });
          response.once('error', error => {
            finish({ kind: 'error', error: this.classifyNodeError(error, state, true) });
          });
          response.once('end', () => {
            void (async () => {
              if (settled) { return; }
              state.timings.download = performance.now() - responseAt;
              try {
                const responseHeaders = this.responseHeaders(response.headers);
                const decoded = await this.decodeBody(
                  Buffer.concat(chunks, receivedBytes),
                  responseHeaders,
                  settings.maxResponseBytes
                );
                if (state.controller.signal.aborted) {
                  finish({ kind: 'error', error: this.classifyNodeError(undefined, state) });
                  return;
                }
                const total = performance.now() - state.startedAt;
                const timings = this.responseTimings(state, total);
                finish({
                  kind: 'response',
                  response: {
                    statusCode,
                    statusText: response.statusMessage ?? '',
                    httpVersion: `HTTP/${response.httpVersion}`,
                    headers: responseHeaders,
                    body: decoded.body,
                    bodyType: decoded.bodyType,
                    size: decoded.bytes.length,
                    duration: total,
                    timings,
                    cookies: this.parseCookies(response.headers['set-cookie']),
                    redirected: state.redirects > 0,
                    finalUrl: this.safeFinalUrl(url, sourceRequest),
                    ...(decoded.mimeType ? { mimeType: decoded.mimeType } : {}),
                  },
                });
              } catch (error) {
                const requestError = error instanceof TransportFailure
                  ? error.requestError
                  : this.classifyNodeError(error, state);
                finish({ kind: 'error', error: requestError });
              }
            })();
          });
        });
      } catch (error) {
        finish({ kind: 'error', error: this.classifyNodeError(error, state) });
        return;
      }

      request.maxHeadersCount = MAX_RESPONSE_HEADERS;
      this.observeSocketTimings(request, state);
      request.once('error', error => {
        finish({ kind: 'error', error: this.classifyNodeError(error, state) });
      });
      request.end(body);
    });
  }

  private observeSocketTimings(request: http.ClientRequest, state: ExecutionState): void {
    request.once('socket', socket => {
      if (!socket.connecting) { return; }
      const assignedAt = performance.now();
      let lookupAt: number | undefined;
      let connectAt: number | undefined;
      socket.once('lookup', () => {
        lookupAt = performance.now();
        state.timings.dns += lookupAt - assignedAt;
        state.timings.dnsObserved = true;
      });
      socket.once('connect', () => {
        connectAt = performance.now();
        state.timings.connect += connectAt - (lookupAt ?? assignedAt);
        state.timings.connectObserved = true;
      });
      socket.once('secureConnect', () => {
        const secureAt = performance.now();
        state.timings.tls += secureAt - (connectAt ?? lookupAt ?? assignedAt);
        state.timings.tlsObserved = true;
      });
    });
  }

  private declaredContentLength(value: string | undefined): number | undefined {
    if (value === undefined || !/^\d+$/.test(value)) { return undefined; }
    const length = Number(value);
    return Number.isSafeInteger(length) ? length : undefined;
  }

  private responseHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
    const entries = Object.entries(headers).filter((entry): entry is [string, string | string[]] =>
      entry[1] !== undefined);
    if (entries.length > MAX_RESPONSE_HEADERS) {
      throw new TransportFailure({
        type: 'invalid-response',
        message: 'The server returned too many response headers.',
      });
    }
    const result: Record<string, string> = {};
    for (const [name, value] of entries) {
      const normalized = Array.isArray(value) ? value.join(', ') : value;
      if (name.length > MAX_HEADER_NAME_LENGTH || normalized.length > MAX_HEADER_VALUE_LENGTH) {
        throw new TransportFailure({
          type: 'invalid-response',
          message: 'The server returned an oversized response header.',
        });
      }
      result[name] = normalized;
    }
    return result;
  }

  private async decodeBody(
    rawBody: Buffer,
    headers: Record<string, string>,
    maximumBytes: number
  ): Promise<DecodedBody> {
    let bytes = rawBody;
    const encodings = (this.headerValue(headers, 'content-encoding') || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
      .reverse();
    for (const encoding of encodings) {
      if (encoding === 'identity') { continue; }
      try {
        if (encoding === 'gzip' || encoding === 'x-gzip') {
          bytes = await boundedDecompress(gunzip as Decompressor, bytes, maximumBytes);
        } else if (encoding === 'deflate') {
          bytes = await boundedDecompress(inflate as Decompressor, bytes, maximumBytes);
        } else if (encoding === 'br') {
          bytes = await boundedDecompress(brotliDecompress as Decompressor, bytes, maximumBytes);
        } else {
          throw new TransportFailure({
            type: 'decompression',
            message: 'The response uses an unsupported content encoding.',
          });
        }
      } catch (error) {
        if (error instanceof TransportFailure) { throw error; }
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
          throw new TransportFailure(this.responseTooLargeError(maximumBytes));
        }
        throw new TransportFailure({
          type: 'decompression',
          message: 'The response body could not be decompressed.',
        });
      }
    }
    if (bytes.length > maximumBytes) {
      throw new TransportFailure(this.responseTooLargeError(maximumBytes));
    }

    const contentType = this.parseContentType(this.headerValue(headers, 'content-type'));
    const bodyType = this.detectBodyType(contentType.mimeType, bytes);
    if (bodyType === 'binary' || bodyType === 'image') {
      return {
        body: bytes.toString('base64'),
        bodyType,
        bytes,
        ...(contentType.mimeType ? { mimeType: contentType.mimeType } : {}),
      };
    }
    const text = this.decodeText(bytes, contentType.charset);
    if (this.jsonStringByteLength(text, 4 * Math.ceil(maximumBytes / 3)) === undefined) {
      return {
        body: bytes.toString('base64'),
        bodyType: 'binary',
        bytes,
        ...(contentType.mimeType ? { mimeType: contentType.mimeType } : {}),
      };
    }
    return {
      body: text,
      bodyType,
      bytes,
      ...(contentType.mimeType ? { mimeType: contentType.mimeType } : {}),
    };
  }

  private parseContentType(value: string | undefined): { mimeType?: string; charset?: string } {
    if (!value) { return {}; }
    const [rawMimeType, ...parameters] = value.split(';');
    const mimeType = rawMimeType.trim().toLowerCase();
    const validMimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)
      ? mimeType
      : undefined;
    const charsetParameter = parameters.find(parameter => /^\s*charset\s*=/i.test(parameter));
    const charset = charsetParameter
      ?.slice(charsetParameter.indexOf('=') + 1)
      .trim()
      .replace(/^"|"$/g, '');
    return {
      ...(validMimeType ? { mimeType: validMimeType } : {}),
      ...(charset ? { charset } : {}),
    };
  }

  private detectBodyType(mimeType: string | undefined, bytes: Buffer): ResponseBodyType {
    if (mimeType?.endsWith('/json') || mimeType?.endsWith('+json')) { return 'json'; }
    if (mimeType === 'text/html') { return 'html'; }
    if (mimeType?.endsWith('/xml') || mimeType?.endsWith('+xml')) { return 'xml'; }
    if (mimeType?.startsWith('image/')) { return 'image'; }
    if (mimeType?.startsWith('text/')
      || mimeType === 'application/javascript'
      || mimeType === 'application/graphql'
      || mimeType === 'application/x-www-form-urlencoded') {
      return 'text';
    }
    if (!mimeType && bytes.length === 0) { return 'unknown'; }
    if (!mimeType) {
      const candidate = this.decodeText(bytes, 'utf-8').trim();
      if (candidate.startsWith('{') || candidate.startsWith('[')) {
        try {
          JSON.parse(candidate);
          return 'json';
        } catch {
          // Fall through to exact binary preservation.
        }
      }
    }
    return 'binary';
  }

  private decodeText(bytes: Buffer, charset = 'utf-8'): string {
    try {
      return new TextDecoder(charset, { fatal: false }).decode(bytes);
    } catch {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  }

  private jsonStringByteLength(value: string, maximum: number): number | undefined {
    let bytes = 2;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09
        || code === 0x0a || code === 0x0c || code === 0x0d) {
        bytes += 2;
      } else if (code < 0x20) {
        bytes += 6;
      } else if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else {
          bytes += 6;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        bytes += 6;
      } else {
        bytes += 3;
      }
      if (bytes > maximum) { return undefined; }
    }
    return bytes;
  }

  private parseCookies(values: string[] | undefined): ResponseCookie[] {
    return (values || []).slice(0, 200).flatMap(value => {
      const parts = value.split(';').map(part => part.trim());
      const [name, ...rawValue] = parts[0].split('=');
      if (!name) { return []; }
      const cookie: ResponseCookie = {
        name: name.slice(0, MAX_HEADER_NAME_LENGTH),
        value: rawValue.join('=').slice(0, MAX_HEADER_VALUE_LENGTH),
      };
      for (const attribute of parts.slice(1)) {
        const [rawName, ...rawAttributeValue] = attribute.split('=');
        const attributeName = rawName.toLowerCase();
        const attributeValue = rawAttributeValue.join('=');
        if (attributeName === 'domain') { cookie.domain = attributeValue; }
        else if (attributeName === 'path') { cookie.path = attributeValue; }
        else if (attributeName === 'expires') { cookie.expires = attributeValue; }
        else if (attributeName === 'httponly') { cookie.httpOnly = true; }
        else if (attributeName === 'secure') { cookie.secure = true; }
      }
      return [cookie];
    });
  }

  private headerValue(headers: Record<string, string>, name: string): string | undefined {
    const match = Object.entries(headers).find(([headerName]) =>
      headerName.toLowerCase() === name.toLowerCase());
    return match?.[1];
  }

  private classifyNodeError(
    error: unknown,
    state: ExecutionState,
    responseStarted = false
  ): RequestError {
    if (state.timedOut) {
      return { type: 'timeout', message: 'The request exceeded its configured timeout.' };
    }
    if (state.cancelled || state.controller.signal.aborted) {
      return { type: 'aborted', message: 'The request was cancelled.' };
    }
    if (responseStarted) {
      return { type: 'socket', message: 'The connection closed before the response completed.' };
    }
    const code = (error as NodeJS.ErrnoException | undefined)?.code || '';
    if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL'].includes(code)) {
      return { type: 'dns', message: 'The server name could not be resolved.' };
    }
    if (code === 'EPROTO'
      || code.startsWith('ERR_TLS_')
      || code.startsWith('CERT_')
      || code.startsWith('UNABLE_')
      || code.startsWith('DEPTH_')) {
      return { type: 'ssl', message: 'The TLS connection could not be established.' };
    }
    if (code.startsWith('HPE_')) {
      return { type: 'invalid-response', message: 'The server returned an invalid HTTP response.' };
    }
    if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(code)) {
      return { type: 'socket', message: 'The network socket failed before the request completed.' };
    }
    if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN'].includes(code)) {
      return { type: 'network', message: 'The connection could not be established.' };
    }
    return { type: 'unknown', message: 'The HTTP request could not be completed.' };
  }

  private responseTooLargeError(maximumBytes: number): RequestError {
    return {
      type: 'response-too-large',
      message: `The response exceeded the configured ${maximumBytes}-byte limit.`,
    };
  }

  private responseTimings(state: ExecutionState, total: number): ResponseTimings {
    return {
      ...(state.timings.dnsObserved ? { dns: state.timings.dns } : {}),
      ...(state.timings.connectObserved ? { connect: state.timings.connect } : {}),
      ...(state.timings.tlsObserved ? { tls: state.timings.tls } : {}),
      ...(state.timings.firstByte !== undefined ? { firstByte: state.timings.firstByte } : {}),
      ...(state.timings.download !== undefined ? { download: state.timings.download } : {}),
      total,
    };
  }

  private safeFinalUrl(url: URL, request: JustRequest): string {
    const safe = new URL(url);
    safe.username = '';
    safe.password = '';
    if (request.auth.type === 'apiKey' && request.auth.in === 'query') {
      for (const key of Array.from(safe.searchParams.keys())) {
        if (key === request.auth.name) {
          safe.searchParams.set(key, '<REDACTED>');
        }
      }
    }
    return safe.toString().slice(0, MAX_URL_LENGTH);
  }

  private errorResponse(
    state: ExecutionState,
    error: RequestError,
    url?: URL,
    request?: JustRequest
  ): JustResponse {
    const total = performance.now() - state.startedAt;
    return {
      statusCode: 0,
      statusText: '',
      httpVersion: '',
      headers: {},
      body: '',
      bodyType: 'unknown',
      size: 0,
      duration: total,
      timings: this.responseTimings(state, total),
      cookies: [],
      error,
      redirected: state.redirects > 0,
      ...(url && request ? { finalUrl: this.safeFinalUrl(url, request) } : {}),
    };
  }
}
