import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestService } from '../../services/RequestService';
import { ResponseDownloadService } from '../../services/ResponseDownloadService';
import type { RequestPreparation } from '../../services/RequestPreparationService';
import type { CollectionService } from '../../services/CollectionService';
import type { HistoryService } from '../../services/HistoryService';
import type { JustResponse } from '../../models/Response';
import type { ExtensionMessage } from '../../models/MessageProtocol';
import { validateExtensionMessage } from '../../protocol/MessageValidator';
import { HttpClient } from '../../engine/http/HttpClient';
import { boundResponseText } from '../../webview/ResponsePresentation';
import { createRequestFixture } from '../fixtures/requestFixtures';

const preparation = { resolve: async request => ({ ok: true, request, diagnostics: [] }), resolveForTransport: async request => request, redactForDerivative: request => request,
      preview: async () => ({ resolvedUrl: '', resolvedHeaders: '[]', resolvedQueryParams: '[]', resolvedBody: '', diagnostics: [], canExecute: true }) } satisfies RequestPreparation;
const collections = { getPersistedRequest: () => undefined } as unknown as CollectionService;
const history = { record: async () => ({ id: 'summary' }) } as unknown as HistoryService;

test('saves complete HTTP response bytes across charset/BOM, binary, compression, preview limits, error statuses and no-content responses without resending', async context => {
  const root = await mkdtemp(join(tmpdir(), 'justapi-download-http-')); context.after(() => rm(root, { recursive: true, force: true }));
  const text = Buffer.from('\uFEFF' + 'á\r\n'.repeat(80000), 'utf8');
  const vectors = [
    { name: 'latin1', bytes: Buffer.from([0xe9, 13, 10, 0x80]), type: 'text/plain; charset=iso-8859-1' },
    { name: 'utf16', bytes: Buffer.from('\uFEFFá\r\n✓', 'utf16le'), type: 'text/plain; charset=utf-16le' },
    { name: 'invalid-utf8', bytes: Buffer.from([0xef, 0xbb, 0xbf, 0xff, 0xc3, 0x28]), type: 'text/plain; charset=utf-8' },
    { name: 'large-text', bytes: text, type: 'text/plain; charset=utf-8' },
    { name: 'binary', bytes: Buffer.from(Array.from({ length: 256 * 4096 }, (_, index) => index % 256)), type: 'application/octet-stream' },
    { name: 'image', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]), type: 'image/png' },
    { name: 'gzip', bytes: text, type: 'text/plain; charset=utf-8', encoding: 'gzip', wire: gzipSync(text) },
    { name: 'deflate', bytes: text, type: 'text/plain; charset=utf-8', encoding: 'deflate', wire: deflateSync(text) },
    { name: 'brotli', bytes: text, type: 'text/plain; charset=utf-8', encoding: 'br', wire: brotliCompressSync(text) },
    { name: 'server-error', bytes: Buffer.from(' { "error": true }\r\n'), type: 'application/json', status: 500 },
    { name: 'empty', bytes: Buffer.alloc(0), type: 'application/octet-stream', status: 204 },
    { name: 'head', bytes: Buffer.alloc(0), type: 'application/octet-stream', status: 200 },
  ];
  let calls = 0;
  const server = createServer((request, response) => {
    calls++; const vector = vectors.find(value => request.url === '/' + value.name)!;
    response.statusCode = vector.status ?? 200; response.setHeader('content-type', vector.type);
    response.setHeader('content-disposition', 'attachment; filename="../../must-not-choose-this-path.exe"');
    if (vector.encoding) { response.setHeader('content-encoding', vector.encoding); }
    if (vector.name === 'head') { response.setHeader('content-encoding', 'gzip'); response.setHeader('content-length', '20971520'); }
    response.end(vector.wire ?? vector.bytes);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let destination = ''; const downloads = new ResponseDownloadService(async suggested => { assert.match(suggested, /^response\.[a-z]+$/); return destination; });
  const requests = new RequestService(preparation, collections, history, undefined, undefined, downloads); context.after(() => requests.dispose());
  for (const [index, vector] of vectors.entries()) {
    let response: JustResponse | undefined;
    const operationId = `download-${index}`; const executionId = `execution-${index}`;
    await requests.execute({ type: 'executeRequest', operationId, executionId, request: createRequestFixture({ url: baseUrl + '/' + vector.name, method: vector.name === 'head' ? 'HEAD' : 'GET' }) }, event => { if (event.type === 'response') { response = event.response; assert.equal(validateExtensionMessage(event).ok, true); } });
    assert.equal(response?.error, undefined); assert.equal(response?.download?.available, true); assert.equal(response?.size, vector.bytes.length);
    if (vector.name === 'large-text') { assert.ok(boundResponseText(response!.body).omittedCharacters > 0); assert.notDeepEqual(Buffer.from(response!.body, 'utf8'), vector.bytes); }
    if (vector.name === 'latin1') { assert.notDeepEqual(Buffer.from(response!.body, 'utf8'), vector.bytes); }
    destination = join(root, vector.name + '.data'); const before = calls;
    const saved = await downloads.save(response!.download!.responseId);
    assert.equal(saved.bytes, vector.bytes.length); assert.deepEqual(await readFile(destination), vector.bytes); assert.equal(calls, before);
    requests.finalize(operationId, executionId, () => undefined);
  }
  assert.equal(calls, vectors.length); assert.equal((await readdir(root)).length, vectors.length);
});

test('never offers failed, oversized, incomplete or cancelled bodies and invalidates previous downloads on resend/dispose', async context => {
  const root = await mkdtemp(join(tmpdir(), 'justapi-download-failure-')); context.after(() => rm(root, { recursive: true, force: true }));
  let signalStarted: () => void = () => undefined; const slowStarted = new Promise<void>(resolve => { signalStarted = resolve; });
  const server = createServer((request, response) => {
    if (request.url === '/slow') { response.writeHead(200); response.write('incomplete'); signalStarted(); return; }
    if (request.url === '/too-large') { response.writeHead(200, { 'content-length': 2048 }); response.end(Buffer.alloc(2048)); }
    else if (request.url === '/broken') { response.writeHead(200, { 'content-encoding': 'gzip' }); response.end('not gzip'); }
    else if (request.url === '/partial') { response.writeHead(200, { 'content-length': 100 }); response.write('partial'); response.destroy(); }
    else { response.end('complete'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const downloads = new ResponseDownloadService(async () => join(root, 'must-not-write.bin'));
  const requests = new RequestService(preparation, collections, history, undefined, undefined, downloads); context.after(() => requests.dispose());
  const source = createRequestFixture({ url: baseUrl }); let original: JustResponse | undefined;
  await requests.execute({ type: 'executeRequest', operationId: 'original', executionId: 'original', request: source }, event => { if (event.type === 'response') { original = event.response; } });
  requests.finalize('original', 'original', () => undefined); assert.ok(original?.download?.available);
  const events: ExtensionMessage[] = [];
  for (const path of ['/too-large', '/broken', '/partial']) {
    await requests.execute({ type: 'executeRequest', operationId: path, executionId: path, request: { ...source, url: baseUrl + path, settings: { ...source.settings, maxResponseBytes: 1024 } } }, event => events.push(event));
    requests.finalize(path, path, () => undefined);
  }
  assert.ok(events.some(event => event.type === 'responseBodiesReleased' && event.responseIds.includes(original!.download!.responseId)));
  for (const event of events) { if (event.type === 'response') { assert.ok(event.response.error); assert.equal(event.response.download, undefined); } }
  await assert.rejects(downloads.save(original!.download!.responseId)); assert.deepEqual(await readdir(root), []);
  const client = new HttpClient(); await client.execute(source); assert.equal(client.takeResponseBody()!.toString(), 'complete'); assert.equal(client.takeResponseBody(), undefined);
  await client.execute({ ...source, url: baseUrl + '/too-large', settings: { ...source.settings, maxResponseBytes: 1024 } }); assert.equal(client.takeResponseBody(), undefined);
  const cancelled: ExtensionMessage[] = [];
  const executing = requests.execute({ type: 'executeRequest', operationId: 'slow', executionId: 'slow', request: { ...source, url: baseUrl + '/slow' } }, event => cancelled.push(event));
  await slowStarted; requests.cancel('cancel', 'slow', event => cancelled.push(event)); await executing; requests.finalize('slow', 'slow', () => undefined);
  assert.equal(cancelled.some(event => event.type === 'response'), false);
  requests.dispose(); await assert.rejects(downloads.save(original!.download!.responseId));
});
