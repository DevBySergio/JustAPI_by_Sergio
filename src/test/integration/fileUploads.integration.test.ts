import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { File } from 'node:buffer';
import { spawn } from 'node:child_process';
import { RequestFileService } from '../../services/RequestFileService';
import { HttpClient } from '../../engine/http/HttpClient';
import { RequestService } from '../../services/RequestService';
import { RequestPreparationService } from '../../services/RequestPreparationService';
import { CollectionService } from '../../services/CollectionService';
import { CollectionManager } from '../../engine/collection/CollectionManager';
import { JsonFileStore } from '../../storage/JsonFileStore';
import { AuthService } from '../../engine/auth/AuthService';
import { VariableSetManager } from '../../engine/variables/VariableSetManager';
import { VariableEngine } from '../../engine/variables/VariableEngine';
import { PersistenceService } from '../../services/PersistenceService';
import { CodeGenerator } from '../../commands/CodeGenerator';
import type { HistoryService } from '../../services/HistoryService';
import type { JustRequest } from '../../models/Request';
import type { JustResponse } from '../../models/Response';
import { createRequestFixture } from '../fixtures/requestFixtures';

async function fixture(context: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'justapi-upload-http-')); context.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'chosen.bin'); const bytes = Buffer.from(Array.from({ length: 256 * 16 }, (_, i) => i % 256)); await writeFile(path, bytes);
  const calls: Array<{ url?: string; headers: IncomingHttpHeaders; bytes: Buffer; method?: string }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
      calls.push({ url: request.url, method: request.method, headers: request.headers, bytes: Buffer.concat(chunks) });
      if (request.url === '/307' || request.url === '/303') { response.writeHead(Number(request.url.slice(1)), { location: '/final' }); }
      response.end('OK');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const files = new RequestFileService(async () => path); const file = (await files.select('request'))!;
  const request = createRequestFixture({ id: 'request', method: 'POST', url, body: { type: 'binary', content: '', binarySource: 'file', file } });
  const client = () => new HttpClient({ readFile: (id, ref) => files.bytes(id, ref), boundaryFactory: () => 'JustAPI-boundary' });
  return { root, path, bytes, calls, files, file, request, client };
}

test('sends selected raw bytes and empty files with exact lengths, explicit MIME and 307/303 redirect semantics', async context => {
  const { path, bytes, calls, files, request, client } = await fixture(context);
  for (const suffix of ['', '/307', '/303']) {
    const response = await client().execute({ ...request, url: request.url + suffix, body: { ...request.body, contentType: 'image/png' } });
    assert.equal(response.error, undefined);
  }
  assert.equal(calls.length, 5);
  for (const call of calls.slice(0, 4)) { assert.deepEqual(call.bytes, bytes); assert.equal(call.headers['content-length'], String(bytes.length)); assert.equal(call.headers['content-type'], 'image/png'); }
  assert.equal(calls[4].method, 'GET'); assert.equal(calls[4].bytes.length, 0); assert.equal(calls[4].headers['content-type'], undefined);
  await writeFile(path, ''); const file = (await files.select(request.id))!;
  const response = await client().execute({ ...request, body: { ...request.body, file }, headers: [{ id: 'ct', key: 'Content-Type', value: 'application/pdf', enabled: true }] });
  assert.equal(response.error, undefined); assert.equal(calls[5].bytes.length, 0); assert.equal(calls[5].headers['content-length'], '0'); assert.equal(calls[5].headers['content-type'], 'application/pdf');
});

test('sends multipart text plus repeated file fields byte-for-byte, ignores disabled parts and manages its own matching boundary', async context => {
  const { bytes, calls, file, request, client } = await fixture(context);
  const multipart: JustRequest = { ...request, headers: [{ id: 'ct', key: 'Content-Type', value: 'incorrect/custom', enabled: true }], body: { type: 'form-data', content: '', formData: [{ id: 'text', key: 'title', value: 'á\r\nvalue', enabled: true }], files: [
    { id: 'file1', key: 'upload', enabled: true, file, contentType: 'image/png' }, { id: 'file2', key: 'upload', enabled: true, file }, { id: 'disabled', key: 'ignored', enabled: false },
  ] } };
  const response = await client().execute(multipart); assert.equal(response.error, undefined);
  const expected = Buffer.concat([Buffer.from('--JustAPI-boundary\r\nContent-Disposition: form-data; name="title"\r\n\r\ná\r\nvalue\r\n'),
    Buffer.from('--JustAPI-boundary\r\nContent-Disposition: form-data; name="upload"; filename="chosen.bin"\r\nContent-Type: image/png\r\n\r\n'), bytes, Buffer.from('\r\n'),
    Buffer.from('--JustAPI-boundary\r\nContent-Disposition: form-data; name="upload"; filename="chosen.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'), bytes, Buffer.from('\r\n--JustAPI-boundary--\r\n')]);
  assert.deepEqual(calls[0].bytes, expected); assert.equal(calls[0].headers['content-type'], 'multipart/form-data; boundary=JustAPI-boundary'); assert.equal(calls[0].headers['content-length'], String(expected.length));
});

test('blocks expired, changed, forged, missing and oversized selections before connecting; preserves references only in the current local session', async context => {
  const { root, path, calls, files, file, request, client } = await fixture(context);
  const store = new JsonFileStore(join(root, 'data')); const auth = new AuthService({ get: async () => undefined, store: async () => undefined, delete: async () => undefined });
  const collections = new CollectionService(new CollectionManager(store), auth, files); const sets = new VariableSetManager(store);
  const preparation = new RequestPreparationService(new VariableEngine(), collections, sets, new PersistenceService(store, store), auth, undefined, files);
  const service = new RequestService(preparation, collections, { record: async () => ({ id: 'history' }) } as unknown as HistoryService, undefined, client);
  context.after(async () => { service.dispose(); await collections.dispose(); await sets.dispose(); await auth.dispose(); await store.dispose(); });
  await collections.load(); await sets.load();
  await collections.createCollection('Upload'); const collection = collections.getCollections()[0];
  await collections.saveRequest(request, collection.id);
  assert.deepEqual(collections.getRequest(request.id)!.body.file, file);
  const exported = await collections.exportDocument(collection.id, false, async () => false); assert.doesNotMatch(exported.json, new RegExp(file.id));
  await collections.deleteCollection(collection.id);
  const imported = await collections.importDocument(exported.json); assert.equal(collections.getRequestsForCollection(imported.collectionId)[0].body.file, undefined);
  const execute = async (candidate: JustRequest) => {
    const events: JustResponse[] = []; const id = `execution-${Math.random()}`;
    try { await service.execute({ type: 'executeRequest', operationId: id, executionId: id, request: candidate }, event => { if (event.type === 'response') { events.push(event.response); } }); }
    finally { service.finalize(id, id, () => undefined); }
    return events;
  };
  for (const candidate of [{ ...request, body: { ...request.body, file: undefined } }, { ...request, id: 'other' }, { ...request, body: { ...request.body, file: { ...file, name: 'forged' } } }]) {
    assert.equal((await preparation.preview(candidate)).canExecute, false); await assert.rejects(execute(candidate));
  }
  await writeFile(path, 'changed'); assert.equal((await preparation.preview(request)).canExecute, false); await assert.rejects(execute(request));
  // Simulate a race after preflight by calling the transport with the old snapshot.
  assert.ok((await client().execute(request)).error); assert.equal(calls.length, 0);
  files.reset(); assert.equal(collections.getRequest(request.id)!.body.file, undefined); await assert.rejects(execute(request)); assert.equal(calls.length, 0);
});

test('cancellation during file preparation and multipart size/boundary failures create no connection', async context => {
  const { calls, request, file, bytes } = await fixture(context);
  let finish: (value: Buffer) => void = () => undefined; let started: () => void = () => undefined; const reading = new Promise<void>(resolve => { started = resolve; });
  const client = new HttpClient({ readFile: () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  const sending = client.execute(request); await reading; client.cancel(); finish(bytes); assert.equal((await sending).error?.type, 'aborted'); assert.equal(calls.length, 0);
  const multipart: JustRequest = { ...request, body: { type: 'form-data', content: '', files: [{ id: 'part', key: 'upload', enabled: true, file }] } };
  const conflict = new HttpClient({ readFile: async () => bytes, boundaryFactory: () => 'JustAPI' });
  const conflictBytes = Buffer.concat([Buffer.from('JustAPI'), bytes.subarray(7)]);
  assert.ok((await new HttpClient({ readFile: async () => conflictBytes, boundaryFactory: () => 'JustAPI' }).execute(multipart)).error);
  assert.equal((await conflict.execute(multipart)).error, undefined); // Different payload: boundary absent.
  const big = Buffer.alloc(10 * 1024 * 1024); const large = { ...file, size: big.length };
  const tooLarge: JustRequest = { ...request, body: { type: 'form-data', content: '', files: [1, 2, 3].map(id => ({ id: String(id), key: 'upload', enabled: true, file: large })) } };
  assert.ok((await new HttpClient({ readFile: async () => big }).execute(tooLarge)).error); assert.equal(calls.length, 1);
});

test('generated curl raw/multipart recipes send original file bytes after explicit placeholder replacement', async context => {
  const { path, bytes, calls, file, request } = await fixture(context); const generator = new CodeGenerator();
  const variants = [request, { ...request, body: { type: 'form-data' as const, content: '', formData: [{ id: 'text', key: 'a=title', value: 'á;\r\ntext', enabled: true }], files: [{ id: 'part', key: 'a=upload', enabled: true, file, contentType: 'image/png' }] } }];
  for (const candidate of variants) {
    const code = generator.generate(candidate, 'curl').replaceAll('<LOCAL_FILE_1>', path);
    await new Promise<void>((resolve, reject) => { const child = spawn('/bin/sh', ['-c', code], { stdio: ['ignore', 'ignore', 'pipe'] }); let errors = ''; child.stderr.on('data', value => { errors += value; }); child.on('error', reject); child.on('exit', status => status === 0 ? resolve() : reject(Error(errors))); });
  }
  assert.deepEqual(calls[0].bytes, bytes); assert.ok(calls[1].bytes.includes(bytes)); assert.ok(calls[1].bytes.includes(Buffer.from('á;\r\ntext')));
  assert.match(calls[1].headers['content-type']!, /^multipart\/form-data; boundary=/); assert.ok(calls[1].bytes.includes(Buffer.from('name="a=upload"; filename="chosen.bin"')));
});

test('generated browser JavaScript recipes send binary and multipart bytes using file inputs and Web APIs', async context => {
  const { bytes, calls, file, request } = await fixture(context); const generator = new CodeGenerator();
  for (const candidate of [request, { ...request, body: { type: 'form-data' as const, content: '', formData: [{ id: 'text', key: 'title', value: 'á value', enabled: true }], files: [{ id: 'part', key: 'upload', enabled: true, file, contentType: 'image/png' }] } }]) {
    let button: { onclick?: () => void } = {};
    await new Promise<void>((resolve, reject) => {
      runInNewContext(generator.generate(candidate, 'javascript'), {
        document: { body: { appendChild: () => undefined }, createElement: (tag: string) => {
          if (tag === 'button') { button = {}; return button; }
          return { files: [new File([bytes], file.name)], setAttribute: () => undefined };
        } }, Blob, FormData, Headers, AbortSignal,
        fetch: async (...args: Parameters<typeof fetch>) => { try { const response = await fetch(...args); await response.clone().text(); resolve(); return response; } catch (error) { reject(error); throw error; } },
        console: { log: () => undefined, error: reject },
      }); button.onclick!();
    });
  }
  assert.deepEqual(calls[0].bytes, bytes); assert.equal(calls[0].headers['content-type'], 'application/octet-stream');
  assert.ok(calls[1].bytes.includes(bytes)); assert.ok(calls[1].bytes.includes(Buffer.from('á value'))); assert.ok(calls[1].bytes.includes(Buffer.from('Content-Type: image/png')));
});
