"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = void 0;
const https = __importStar(require("node:https"));
const http = __importStar(require("node:http"));
const node_url_1 = require("node:url");
const MAX_REDIRECTS = 10;
class HttpClient {
    abortController = null;
    cancel() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
    async execute(request) {
        return this.executeWithRedirects(request, 0);
    }
    async executeWithRedirects(request, redirectCount) {
        this.abortController = new AbortController();
        const startTime = performance.now();
        try {
            const url = this.buildUrl(request.url, request.queryParams);
            const parsedUrl = new node_url_1.URL(url);
            const isHttps = parsedUrl.protocol === 'https:';
            const headers = this.buildHeaders(request.headers, request.body);
            const bodyContent = this.buildBody(request.body);
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: request.method,
                headers,
                timeout: request.settings.timeout,
                rejectUnauthorized: request.settings.verifySSL,
            };
            const mod = isHttps ? https : http;
            return new Promise((resolve) => {
                const req = mod.request(options, async (res) => {
                    const redirectStatus = res.statusCode ?? 0;
                    const isRedirect = redirectStatus >= 300 && redirectStatus < 400;
                    if (request.settings.followRedirects && isRedirect && redirectCount < MAX_REDIRECTS && res.headers.location) {
                        const redirectUrl = res.headers.location;
                        // Resolve relative redirect URL
                        const resolvedUrl = redirectUrl.startsWith('http')
                            ? redirectUrl
                            : `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl.startsWith('/') ? '' : '/'}${redirectUrl}`;
                        const redirectedRequest = {
                            ...request,
                            url: resolvedUrl,
                        };
                        this.abortController = null;
                        const redirectResponse = await this.executeWithRedirects(redirectedRequest, redirectCount + 1);
                        resolve(redirectResponse);
                        return;
                    }
                    const chunks = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => {
                        const duration = performance.now() - startTime;
                        const rawBody = Buffer.concat(chunks);
                        const bodyStr = rawBody.toString('utf-8');
                        const rawHeaders = res.headers;
                        const responseHeaders = {};
                        for (const [k, v] of Object.entries(rawHeaders)) {
                            responseHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
                        }
                        const setCookieRaw = res.headers['set-cookie'];
                        const cookies = [];
                        if (setCookieRaw) {
                            const cookieArr = Array.isArray(setCookieRaw) ? setCookieRaw : [setCookieRaw];
                            for (const c of cookieArr) {
                                const parts = c.split(';').map(s => s.trim());
                                const [name, ...valParts] = parts[0].split('=');
                                const cookie = { name, value: valParts.join('=') };
                                for (let i = 1; i < parts.length; i++) {
                                    const [k, ...v] = parts[i].split('=');
                                    const lk = k.toLowerCase();
                                    const vv = v.join('=');
                                    if (lk === 'domain')
                                        cookie.domain = vv;
                                    else if (lk === 'path')
                                        cookie.path = vv;
                                    else if (lk === 'expires')
                                        cookie.expires = vv;
                                    else if (lk === 'httponly')
                                        cookie.httpOnly = true;
                                    else if (lk === 'secure')
                                        cookie.secure = true;
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
                req.on('error', (err) => {
                    const duration = performance.now() - startTime;
                    let error;
                    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
                        error = { type: 'dns', message: `Could not resolve host: ${err.message}` };
                    }
                    else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
                        error = { type: 'ssl', message: `SSL error: ${err.message}` };
                    }
                    else {
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
                    }
                    catch {
                        // Stream may already be destroyed (error/timeout), ignore
                    }
                }
                req.end();
                this.abortController?.signal.addEventListener('abort', () => {
                    req.destroy();
                });
            });
        }
        catch (err) {
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
    buildUrl(baseUrl, queryParams) {
        if (!queryParams || queryParams.length === 0)
            return baseUrl;
        const enabled = queryParams.filter(p => p.enabled && p.key);
        if (enabled.length === 0)
            return baseUrl;
        const separator = baseUrl.includes('?') ? '&' : '?';
        const params = enabled.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
        return `${baseUrl}${separator}${params}`;
    }
    buildHeaders(headers, body) {
        const result = {};
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
            const contentTypeMap = {
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
    buildBody(requestBody) {
        if (requestBody.type === 'none' || !requestBody.content)
            return undefined;
        if (requestBody.type === 'form-data' && requestBody.formData) {
            const boundary = `----FormBoundary${Date.now()}`;
            const parts = [];
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
    detectBodyType(headers, body) {
        const ct = (headers['content-type'] || '').toLowerCase();
        if (ct.includes('application/json'))
            return 'json';
        if (ct.includes('text/html'))
            return 'html';
        if (ct.includes('application/xml') || ct.includes('text/xml'))
            return 'xml';
        if (ct.includes('image/'))
            return 'image';
        if (ct.includes('text/'))
            return 'text';
        if (body.length > 0) {
            const str = body.toString('utf-8').trim();
            if (str.startsWith('{') || str.startsWith('[')) {
                try {
                    JSON.parse(str);
                    return 'json';
                }
                catch { /* not json */ }
            }
        }
        return 'binary';
    }
}
exports.HttpClient = HttpClient;
//# sourceMappingURL=HttpClient.js.map