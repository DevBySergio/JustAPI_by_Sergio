import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';
import { JustRequest, BodyType } from '../../models/Request';
import { KeyValuePair } from '../../models/KeyValuePair';
import { JustResponse, BodyType as ResponseBodyType, ResponseCookie, RequestError } from '../../models/Response';

const MAX_REDIRECTS = 10;

export class HttpClient {
  private abortController: AbortController | null = null;

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async execute(request: JustRequest): Promise<JustResponse> {
    return this.executeWithRedirects(request, 0);
  }

  private async executeWithRedirects(request: JustRequest, redirectCount: number): Promise<JustResponse> {
    this.abortController = new AbortController();
    const startTime = performance.now();

    try {
      const url = this.buildUrl(request.url, request.queryParams);
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const headers = this.buildHeaders(request.headers, request.body);
      const bodyContent = this.buildBody(request.body);

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: request.method,
        headers,
        timeout: request.settings.timeout,
        rejectUnauthorized: request.settings.verifySSL,
      } as http.RequestOptions & { rejectUnauthorized: boolean };

      const mod = isHttps ? https : http;

      return new Promise<JustResponse>((resolve) => {
        const req = mod.request(options, async (res) => {
          const redirectStatus = res.statusCode ?? 0;
          const isRedirect = redirectStatus >= 300 && redirectStatus < 400;

          if (request.settings.followRedirects && isRedirect && redirectCount < MAX_REDIRECTS && res.headers.location) {
            const redirectUrl = res.headers.location;
            // Resolve relative redirect URL
            const resolvedUrl = redirectUrl.startsWith('http')
              ? redirectUrl
              : `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl.startsWith('/') ? '' : '/'}${redirectUrl}`;
            const redirectedRequest: JustRequest = {
              ...request,
              url: resolvedUrl,
            };
            this.abortController = null;
            const redirectResponse = await this.executeWithRedirects(redirectedRequest, redirectCount + 1);
            resolve(redirectResponse);
            return;
          }

          const chunks: Buffer[] = [];

          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const duration = performance.now() - startTime;
            const rawBody = Buffer.concat(chunks);
            const bodyStr = rawBody.toString('utf-8');
            const rawHeaders = res.headers as Record<string, string>;
            const responseHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(rawHeaders)) {
              responseHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
            }

            const setCookieRaw = res.headers['set-cookie'];
            const cookies: ResponseCookie[] = [];
            if (setCookieRaw) {
              const cookieArr = Array.isArray(setCookieRaw) ? setCookieRaw : [setCookieRaw];
              for (const c of cookieArr) {
                const parts = c.split(';').map(s => s.trim());
                const [name, ...valParts] = parts[0].split('=');
                const cookie: ResponseCookie = { name, value: valParts.join('=') };
                for (let i = 1; i < parts.length; i++) {
                  const [k, ...v] = parts[i].split('=');
                  const lk = k.toLowerCase();
                  const vv = v.join('=');
                  if (lk === 'domain') { cookie.domain = vv; }
                  else if (lk === 'path') { cookie.path = vv; }
                  else if (lk === 'expires') { cookie.expires = vv; }
                  else if (lk === 'httponly') { cookie.httpOnly = true; }
                  else if (lk === 'secure') { cookie.secure = true; }
                }
                cookies.push(cookie);
              }
            }

            const bodyType = this.detectBodyType(responseHeaders, rawBody);
            const size = rawBody.length;

            resolve({
              statusCode: redirectStatus,
              statusText: res.statusMessage ?? '',
              httpVersion: `HTTP/${res.httpVersion}`,
              headers: responseHeaders,
              body: bodyStr,
              bodyType,
              size,
              duration,
              cookies,
              redirected: isRedirect,
              finalUrl: undefined,
            });
          });
        });

        req.on('timeout', () => {
          req.destroy();
          const duration = performance.now() - startTime;
          resolve({
            statusCode: 0,
            statusText: '',
            httpVersion: '',
            headers: {},
            body: '',
            bodyType: 'unknown',
            size: 0,
            duration,
            cookies: [],
            redirected: false,
            finalUrl: undefined,
            error: { type: 'timeout', message: `Request timed out after ${request.settings.timeout}ms` },
          });
        });

        req.on('error', (err: NodeJS.ErrnoException) => {
          const duration = performance.now() - startTime;
          let error: RequestError;
          if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
            error = { type: 'dns', message: `Could not resolve host: ${err.message}` };
          } else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
            error = { type: 'ssl', message: `SSL error: ${err.message}` };
          } else {
            error = { type: 'network', message: err.message };
          }
          resolve({
            statusCode: 0,
            statusText: '',
            httpVersion: '',
            headers: {},
            body: '',
            bodyType: 'unknown',
            size: 0,
            duration,
            cookies: [],
            redirected: false,
            finalUrl: undefined,
            error,
          });
        });

        if (bodyContent) {
          try {
            req.write(bodyContent);
          } catch {
            // Stream may already be destroyed (error/timeout), ignore
          }
        }
        req.end();

        this.abortController?.signal.addEventListener('abort', () => {
          req.destroy();
        });
      });
    } catch (err) {
      const duration = performance.now() - startTime;
      return {
        statusCode: 0,
        statusText: '',
        httpVersion: '',
        headers: {},
        body: '',
        bodyType: 'unknown',
        size: 0,
        duration,
        cookies: [],
        redirected: false,
        finalUrl: undefined,
        error: {
          type: 'unknown',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private buildUrl(baseUrl: string, queryParams: KeyValuePair[]): string {
    if (!queryParams || queryParams.length === 0) { return baseUrl; }
    const enabled = queryParams.filter(p => p.enabled && p.key);
    if (enabled.length === 0) { return baseUrl; }
    const separator = baseUrl.includes('?') ? '&' : '?';
    const params = enabled.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
    return `${baseUrl}${separator}${params}`;
  }

  private buildHeaders(headers: KeyValuePair[], body: { type: BodyType }): Record<string, string> {
    const result: Record<string, string> = {};
    let hasContentType = false;
    for (const h of headers) {
      if (h.enabled && h.key) {
        result[h.key] = h.value;
        if (h.key.toLowerCase() === 'content-type') {
          hasContentType = true;
        }
      }
    }
    if (body.type !== 'none' && body.type !== 'form-data' && !hasContentType) {
      const contentTypeMap: Record<string, string> = {
        json: 'application/json',
        'x-www-form-urlencoded': 'application/x-www-form-urlencoded',
        text: 'text/plain',
        xml: 'application/xml',
        binary: 'application/octet-stream',
      };
      if (contentTypeMap[body.type]) {
        result['content-type'] = contentTypeMap[body.type];
      }
    }
    return result;
  }

  private buildBody(requestBody: { type: BodyType; content: string; formData?: KeyValuePair[] }): string | undefined {
    if (requestBody.type === 'none' || !requestBody.content) { return undefined; }
    if (requestBody.type === 'form-data' && requestBody.formData) {
      const boundary = `----FormBoundary${Date.now()}`;
      const parts: string[] = [];
      for (const field of requestBody.formData) {
        if (field.enabled && field.key) {
          parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"\r\n\r\n${field.value}\r\n`);
        }
      }
      parts.push(`--${boundary}--\r\n`);
      return parts.join('');
    }
    if (requestBody.type === 'x-www-form-urlencoded' && requestBody.formData) {
      const params = requestBody.formData
        .filter(f => f.enabled && f.key)
        .map(f => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`)
        .join('&');
      return params;
    }
    return requestBody.content;
  }

  private detectBodyType(headers: Record<string, string>, body: Buffer): ResponseBodyType {
    const ct = (headers['content-type'] || '').toLowerCase();
    if (ct.includes('application/json')) { return 'json'; }
    if (ct.includes('text/html')) { return 'html'; }
    if (ct.includes('application/xml') || ct.includes('text/xml')) { return 'xml'; }
    if (ct.includes('image/')) { return 'image'; }
    if (ct.includes('text/')) { return 'text'; }
    if (body.length > 0) {
      const str = body.toString('utf-8').trim();
      if (str.startsWith('{') || str.startsWith('[')) {
        try { JSON.parse(str); return 'json'; } catch { /* not json */ }
      }
    }
    return 'binary';
  }
}
