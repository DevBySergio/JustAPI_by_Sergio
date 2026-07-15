import * as assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { AuthService, SecretStorageLike } from '../../engine/auth/AuthService';
import { HttpClient } from '../../engine/http/HttpClient';
import {
  HttpMethod,
  RequestSettings,
  RESPONSE_SIZE_LIMITS,
} from '../../models/Request';
import { createRequestFixture } from '../fixtures/requestFixtures';
import { fixtureSecret } from '../fixtures/securityFixtures';
import { HttpFixtureServer, startHttpFixtureServer } from '../support/httpFixtureServer';

class IntegrationSecretStorage implements SecretStorageLike {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> { return this.values.get(key); }
  async store(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

interface EchoBody {
  method: string;
  path: string;
  query: Record<string, string>;
  queryEntries: Array<[string, string]>;
  headers: Record<string, string>;
  body: string;
}

function settings(overrides: Partial<RequestSettings> = {}): RequestSettings {
  return { ...createRequestFixture().settings, ...overrides };
}

describe('HttpClient with deterministic localhost servers', () => {
  let fixtureServer: HttpFixtureServer;
  let crossOriginServer: HttpFixtureServer;

  before(async () => {
    [fixtureServer, crossOriginServer] = await Promise.all([
      startHttpFixtureServer(),
      startHttpFixtureServer(),
    ]);
  });

  after(async () => {
    await Promise.all([fixtureServer.close(), crossOriginServer.close()]);
  });

  test('sends every method and normalizes duplicate headers plus query edge cases', async () => {
    const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
    for (const method of methods) {
      const response = await new HttpClient().execute(createRequestFixture({
        method,
        url: `${fixtureServer.baseUrl}/echo`,
      }));
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['x-fixture-method'], method);
      if (method !== 'HEAD') {
        assert.equal((JSON.parse(response.body) as EchoBody).method, method);
      }
    }

    const response = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/echo?existing=one#ignored`,
      headers: [
        { id: 'first', key: 'X-Fixture', value: 'first', enabled: true },
        { id: 'second', key: 'x-fixture', value: 'last', enabled: true },
        { id: 'disabled', key: 'X-Disabled', value: 'hidden', enabled: false },
      ],
      queryParams: [
        { id: 'space', key: 'spaced value', value: 'one & two', enabled: true },
        { id: 'repeat-one', key: 'repeat', value: 'one', enabled: true },
        { id: 'repeat-two', key: 'repeat', value: 'two', enabled: true },
        { id: 'empty', key: 'empty', value: '', enabled: true },
        { id: 'disabled-query', key: 'disabled', value: 'hidden', enabled: false },
      ],
    }));
    const echo = JSON.parse(response.body) as EchoBody;
    assert.equal(echo.headers['x-fixture'], 'last');
    assert.equal(echo.headers['x-disabled'], undefined);
    assert.equal(echo.query.existing, 'one');
    assert.equal(echo.query['spaced value'], 'one & two');
    assert.deepEqual(echo.queryEntries.filter(([key]) => key === 'repeat'), [
      ['repeat', 'one'],
      ['repeat', 'two'],
    ]);
    assert.equal(echo.query.empty, '');
    assert.doesNotMatch(response.finalUrl ?? '', /#ignored/);
  });

  test('encodes raw, empty, URL-encoded, multipart, and binary request bodies correctly', async () => {
    const rawCases = [
      ['json', '{"fixture":true}', 'application/json; charset=utf-8'],
      ['text', 'hello ü', 'text/plain; charset=utf-8'],
      ['xml', '<fixture>ü</fixture>', 'application/xml; charset=utf-8'],
      ['binary', 'raw\u0000bytes', 'application/octet-stream'],
    ] as const;
    for (const [type, content, contentType] of rawCases) {
      const response = await new HttpClient().execute(createRequestFixture({
        method: 'POST',
        url: `${fixtureServer.baseUrl}/echo`,
        body: { type, content },
      }));
      const echo = JSON.parse(response.body) as EchoBody;
      assert.equal(echo.body, content);
      assert.equal(echo.headers['content-type'], contentType);
      assert.equal(Number(echo.headers['content-length']), Buffer.byteLength(content));
    }

    const emptyJson = await new HttpClient().execute(createRequestFixture({
      method: 'POST',
      url: `${fixtureServer.baseUrl}/echo`,
      body: { type: 'json', content: '' },
    }));
    const emptyJsonEcho = JSON.parse(emptyJson.body) as EchoBody;
    assert.equal(emptyJsonEcho.body, '');
    assert.equal(emptyJsonEcho.headers['content-length'], '0');

    const customContentType = await new HttpClient().execute(createRequestFixture({
      method: 'POST',
      url: `${fixtureServer.baseUrl}/echo`,
      headers: [{
        id: 'custom-content-type',
        key: 'Content-Type',
        value: 'application/problem+json',
        enabled: true,
      }],
      body: { type: 'json', content: '{"custom":true}' },
    }));
    assert.equal(
      (JSON.parse(customContentType.body) as EchoBody).headers['content-type'],
      'application/problem+json'
    );

    const formData = [
      { id: 'field', key: 'fixture key', value: 'fixture value', enabled: true },
      { id: 'unicode', key: '密钥', value: 'välue', enabled: true },
      { id: 'disabled', key: 'hidden', value: 'ignored', enabled: false },
    ];
    const urlEncoded = await new HttpClient().execute(createRequestFixture({
      method: 'POST',
      url: `${fixtureServer.baseUrl}/echo`,
      body: { type: 'x-www-form-urlencoded', content: '', formData },
    }));
    const urlEncodedEcho = JSON.parse(urlEncoded.body) as EchoBody;
    assert.equal(urlEncodedEcho.body, 'fixture+key=fixture+value&%E5%AF%86%E9%92%A5=v%C3%A4lue');
    assert.equal(urlEncodedEcho.headers['content-type'], 'application/x-www-form-urlencoded');

    const multipartClient = new HttpClient({ boundaryFactory: () => 'fixture-boundary' });
    const multipart = await multipartClient.execute(createRequestFixture({
      method: 'POST',
      url: `${fixtureServer.baseUrl}/echo`,
      headers: [{ id: 'wrong-type', key: 'Content-Type', value: 'text/plain', enabled: true }],
      body: {
        type: 'form-data',
        content: '',
        formData: [
          { id: 'quoted', key: 'quoted"\nname', value: 'välue', enabled: true },
          { id: 'disabled', key: 'hidden', value: 'ignored', enabled: false },
        ],
      },
    }));
    const multipartEcho = JSON.parse(multipart.body) as EchoBody;
    assert.equal(
      multipartEcho.headers['content-type'],
      'multipart/form-data; boundary=fixture-boundary'
    );
    assert.match(multipartEcho.body, /name="quoted\\" name"/);
    assert.match(multipartEcho.body, /välue/);
    assert.doesNotMatch(multipartEcho.body, /hidden|ignored/);
    assert.equal(Number(multipartEcho.headers['content-length']), Buffer.byteLength(multipartEcho.body));

    const emptyMultipart = await multipartClient.execute(createRequestFixture({
      method: 'POST',
      url: `${fixtureServer.baseUrl}/echo`,
      body: { type: 'form-data', content: '', formData: [] },
    }));
    assert.equal((JSON.parse(emptyMultipart.body) as EchoBody).body, '--fixture-boundary--\r\n');
  });

  test('resolves relative and query-only redirects without reapplying original query fields', async () => {
    const relative = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/redirect?location=.%2Fecho%3Frelative%3D1`,
    }));
    const relativeEcho = JSON.parse(relative.body) as EchoBody;
    assert.equal(relativeEcho.path, '/echo');
    assert.equal(relativeEcho.query.relative, '1');
    assert.equal(relative.redirected, true);
    assert.match(relative.finalUrl ?? '', /\/echo\?relative=1$/);

    const queryOnly = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/redirect-query?original=1`,
      queryParams: [{ id: 'client', key: 'client', value: '1', enabled: true }],
    }));
    const queryEcho = JSON.parse(queryOnly.body) as EchoBody;
    assert.deepEqual(queryEcho.query, { done: '1' });

    const notFollowed = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/redirect`,
      settings: settings({ followRedirects: false }),
    }));
    assert.equal(notFollowed.statusCode, 302);
    assert.equal(notFollowed.redirected, false);
  });

  test('applies deliberate 301/302/303/307/308 method and body transitions', async () => {
    const cases: Array<{
      status: number;
      method: HttpMethod;
      expectedMethod: HttpMethod;
      preservesBody: boolean;
    }> = [
      { status: 301, method: 'POST', expectedMethod: 'GET', preservesBody: false },
      { status: 302, method: 'POST', expectedMethod: 'GET', preservesBody: false },
      { status: 303, method: 'PUT', expectedMethod: 'GET', preservesBody: false },
      { status: 307, method: 'POST', expectedMethod: 'POST', preservesBody: true },
      { status: 308, method: 'PATCH', expectedMethod: 'PATCH', preservesBody: true },
    ];
    for (const item of cases) {
      const response = await new HttpClient().execute(createRequestFixture({
        method: item.method,
        url: `${fixtureServer.baseUrl}/redirect?status=${item.status}&location=%2Fecho`,
        body: { type: 'json', content: '{"redirect":true}' },
      }));
      const echo = JSON.parse(response.body) as EchoBody;
      assert.equal(echo.method, item.expectedMethod, `status ${item.status}`);
      assert.equal(echo.body, item.preservesBody ? '{"redirect":true}' : '', `status ${item.status}`);
      assert.equal(Boolean(echo.headers['content-type']), item.preservesBody, `status ${item.status}`);
    }
  });

  test('strips credentials on cross-origin redirects while preserving ordinary headers', async () => {
    const target = `${crossOriginServer.baseUrl}/echo`;
    const response = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/redirect?location=${encodeURIComponent(target)}`,
      auth: { type: 'apiKey', name: 'X-Custom-Secret', in: 'header', configured: true },
      headers: [
        { id: 'authorization', key: 'Authorization', value: `Bearer ${fixtureSecret}`, enabled: true },
        { id: 'cookie', key: 'Cookie', value: `session=${fixtureSecret}`, enabled: true },
        { id: 'standard-api-key', key: 'X-API-Key', value: fixtureSecret, enabled: true },
        { id: 'custom-api-key', key: 'X-Custom-Secret', value: fixtureSecret, enabled: true },
        { id: 'ordinary', key: 'X-Ordinary', value: 'preserved', enabled: true },
      ],
    }));
    const echo = JSON.parse(response.body) as EchoBody;
    assert.equal(echo.headers.authorization, undefined);
    assert.equal(echo.headers.cookie, undefined);
    assert.equal(echo.headers['x-api-key'], undefined);
    assert.equal(echo.headers['x-custom-secret'], undefined);
    assert.equal(echo.headers['x-ordinary'], 'preserved');
    assert.doesNotMatch(JSON.stringify(echo.headers), new RegExp(fixtureSecret));
  });

  test('rejects malformed redirects and bounded redirect loops with typed errors', async () => {
    const malformed = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/redirect-invalid`,
    }));
    assert.equal(malformed.error?.type, 'redirect');
    assert.equal(malformed.redirected, false);

    const loop = await new HttpClient({ maxRedirects: 2 }).execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/redirect-loop`,
    }));
    assert.equal(loop.error?.type, 'redirect');
    assert.equal(loop.redirected, true);
    assert.match(loop.error?.message ?? '', /2-hop/);
  });

  test('decompresses gzip, deflate, and Brotli and reports corrupt or unsupported encodings', async () => {
    for (const [path, encoding] of [
      ['/gzip', 'gzip'],
      ['/deflate', 'deflate'],
      ['/brotli', 'br'],
    ] as const) {
      const response = await new HttpClient().execute(createRequestFixture({
        url: `${fixtureServer.baseUrl}${path}`,
      }));
      assert.equal(response.statusCode, 200);
      assert.equal(response.bodyType, 'json');
      assert.equal(response.mimeType, 'application/json');
      assert.deepEqual(JSON.parse(response.body), { encoding, compressed: true });
      assert.equal(response.size, Buffer.byteLength(response.body));
    }

    const corrupt = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/bad-gzip`,
    }));
    assert.equal(corrupt.error?.type, 'decompression');
    const unsupported = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/unsupported-encoding`,
    }));
    assert.equal(unsupported.error?.type, 'decompression');
  });

  test('honors declared charsets and preserves exact binary/image bytes as base64 with MIME type', async () => {
    const charset = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/charset`,
    }));
    assert.equal(charset.body, 'café');
    assert.equal(charset.bodyType, 'text');
    assert.equal(charset.mimeType, 'text/plain');

    const binaryBytes = Buffer.from([0x00, 0xff, 0x01, 0x02, 0x80]);
    const binary = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/binary`,
    }));
    assert.equal(binary.body, binaryBytes.toString('base64'));
    assert.equal(binary.bodyType, 'binary');
    assert.equal(binary.mimeType, 'application/octet-stream');
    assert.equal(binary.size, binaryBytes.length);

    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const image = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/image`,
    }));
    assert.equal(image.body, imageBytes.toString('base64'));
    assert.equal(image.bodyType, 'image');
    assert.equal(image.mimeType, 'image/png');
  });

  test('enforces the 10 MiB default and custom limits on declared, streamed, and decompressed bytes', async () => {
    assert.equal(createRequestFixture().settings.maxResponseBytes, RESPONSE_SIZE_LIMITS.default);

    const allowed = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/large?bytes=1024`,
      settings: settings({ maxResponseBytes: 1024 }),
    }));
    assert.equal(allowed.size, 1024);

    const declared = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/large?bytes=2048`,
      settings: settings({ maxResponseBytes: 1024 }),
    }));
    assert.equal(declared.error?.type, 'response-too-large');

    const streamed = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/stream?bytes=2048&firstMs=0&downloadMs=0`,
      settings: settings({ maxResponseBytes: 1024 }),
    }));
    assert.equal(streamed.error?.type, 'response-too-large');

    const decompressed = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/gzip-large?bytes=2048`,
      settings: settings({ maxResponseBytes: 1024 }),
    }));
    assert.equal(decompressed.error?.type, 'response-too-large');
    assert.doesNotMatch(decompressed.error?.message ?? '', /gzip-large|127\.0\.0\.1/);
  });

  test('isolates cancellation per execution and distinguishes it from timeout', async () => {
    const cancelledClient = new HttpClient();
    const independentClient = new HttpClient();
    const cancelledPromise = cancelledClient.execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/delay?ms=200`,
    }));
    const independentPromise = independentClient.execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/delay?ms=35`,
    }));
    setTimeout(() => cancelledClient.cancel(), 10);

    const [cancelled, independent] = await Promise.all([cancelledPromise, independentPromise]);
    assert.equal(cancelled.error?.type, 'aborted');
    assert.equal(cancelled.error?.message, 'The request was cancelled.');
    assert.equal(independent.statusCode, 200);

    const timeout = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/delay?ms=150`,
      settings: settings({ timeout: 25 }),
    }));
    assert.equal(timeout.error?.type, 'timeout');
    assert.equal(timeout.error?.message, 'The request exceeded its configured timeout.');
  });

  test('reports observable first-byte, download, and total timing', async () => {
    const response = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/stream?bytes=32&firstMs=20&downloadMs=30`,
    }));
    assert.equal(response.statusCode, 200);
    assert.ok((response.timings.firstByte ?? 0) >= 10);
    assert.ok((response.timings.download ?? 0) >= 20);
    assert.ok(response.timings.total >= (response.timings.firstByte ?? 0));
    assert.equal(response.duration, response.timings.total);
  });

  test('classifies DNS, TLS, socket, invalid URL, and invalid header failures without leaking details', async () => {
    const dnsClient = new HttpClient({
      lookup: (_hostname, _options, callback) => {
        const error = Object.assign(new Error(`synthetic-${fixtureSecret}`), { code: 'ENOTFOUND' });
        callback(error, '127.0.0.1', 4);
      },
    });
    const dns = await dnsClient.execute(createRequestFixture({ url: 'http://fixture.invalid' }));
    assert.equal(dns.error?.type, 'dns');
    assert.doesNotMatch(dns.error?.message ?? '', new RegExp(fixtureSecret));

    const tls = await new HttpClient().execute(createRequestFixture({
      url: fixtureServer.baseUrl.replace('http:', 'https:'),
      settings: settings({ verifySSL: false }),
    }));
    assert.equal(tls.error?.type, 'ssl');

    const socket = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/close-early`,
    }));
    assert.equal(socket.error?.type, 'socket');

    const invalidUrl = await new HttpClient().execute(createRequestFixture({ url: 'file:///tmp/private' }));
    assert.equal(invalidUrl.error?.type, 'invalid-url');

    const invalidHeader = await new HttpClient().execute(createRequestFixture({
      url: `${fixtureServer.baseUrl}/echo`,
      headers: [{ id: 'invalid', key: 'X-Fixture', value: 'line\r\nbreak', enabled: true }],
    }));
    assert.equal(invalidHeader.error?.type, 'invalid-response');
  });

  test('sends SecretStorage-backed credentials only after preflight and redacts final auth URLs', async () => {
    const authService = new AuthService(new IntegrationSecretStorage());
    const bearer = createRequestFixture({ url: `${fixtureServer.baseUrl}/echo` });
    bearer.auth = await authService.configure(bearer.id, {
      type: 'bearer',
      token: fixtureSecret,
    });
    const bearerResponse = await new HttpClient().execute(
      await authService.resolveForTransport(bearer)
    );
    const bearerEcho = JSON.parse(bearerResponse.body) as EchoBody;
    assert.equal(bearerEcho.headers.authorization, `Bearer ${fixtureSecret}`);
    assert.equal(JSON.stringify(bearer).includes(fixtureSecret), false);

    const apiKey = createRequestFixture({ url: `${fixtureServer.baseUrl}/echo` });
    apiKey.auth = await authService.configure(apiKey.id, {
      type: 'apiKey',
      name: 'fixture_key',
      in: 'query',
      value: fixtureSecret,
    });
    const apiKeyResponse = await new HttpClient().execute(
      await authService.resolveForTransport(apiKey)
    );
    const apiKeyEcho = JSON.parse(apiKeyResponse.body) as EchoBody;
    assert.equal(apiKeyEcho.query.fixture_key, fixtureSecret);
    assert.doesNotMatch(apiKeyResponse.finalUrl ?? '', new RegExp(fixtureSecret));
    assert.match(apiKeyResponse.finalUrl ?? '', /REDACTED/i);
  });
});
