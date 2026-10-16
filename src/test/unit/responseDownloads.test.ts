import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ResponseDownloadService, responseFileName } from '../../services/ResponseDownloadService';
import { validateExtensionMessage, validateWebviewMessage } from '../../protocol/MessageValidator';
import { OperationCorrelationTracker } from '../../protocol/CorrelationTracker';
import type { JustResponse } from '../../models/Response';

const response = (size: number, bodyType: JustResponse['bodyType'] = 'binary', mimeType?: string): JustResponse => ({ statusCode: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: {}, body: 'displayed value is not the original bytes', bodyType, size, duration: 1, timings: { total: 1 }, cookies: [], redirected: false, ...(mimeType ? { mimeType } : {}) });
async function directory(context: { after: (callback: () => Promise<void>) => void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'justapi-download-')); context.after(() => rm(root, { recursive: true, force: true })); return root;
}

test('writes retained binary and non-UTF-8 bytes exactly, supports empty bodies and explicit overwrite', async context => {
  const root = await directory(context); const destination = join(root, 'body.bin'); let suggested = '';
  const downloads = new ResponseDownloadService(async name => { suggested = name; return destination; });
  const bytes = Buffer.from([0, 255, 254, 13, 10, 0x80, 0xe9]);
  const first = downloads.retain('request', bytes, response(bytes.length, 'text', 'text/plain'));
  assert.deepEqual(first.released, []); assert.equal(first.download.available, true);
  const result = await downloads.save(first.download.responseId);
  assert.equal(suggested, 'response.txt'); assert.equal(result.status, 'saved'); assert.equal(result.bytes, bytes.length); assert.equal(result.fileName, 'body.bin');
  assert.deepEqual(await readFile(destination), bytes);
  const empty = downloads.retain('request', Buffer.alloc(0), response(0)); assert.deepEqual(empty.released, [first.download.responseId]);
  await downloads.save(empty.download.responseId); assert.equal((await readFile(destination)).length, 0);
  assert.deepEqual(await readdir(root), ['body.bin']);
});

test('cancelled picker creates no files, does not discard the body and permits a later save', async context => {
  const root = await directory(context); let destination: string | undefined;
  const downloads = new ResponseDownloadService(async () => destination);
  const retained = downloads.retain('request', Buffer.from('body'), response(4));
  assert.deepEqual(await downloads.save(retained.download.responseId), { responseId: retained.download.responseId, status: 'cancelled' });
  assert.deepEqual(await readdir(root), []); destination = join(root, 'retry.bin');
  await downloads.save(retained.download.responseId); assert.equal(await readFile(destination, 'utf8'), 'body');
});

test('failed disk commit preserves the existing destination and original bytes for retry, with no temporary leftovers', async context => {
  const root = await directory(context); const destination = join(root, 'existing.bin'); await writeFile(destination, 'keep this file'); let fail = true;
  const downloads = new ResponseDownloadService(async () => destination, { beforeCommit: async () => { if (fail) { throw new Error('Synthetic disk failure'); } } });
  const retained = downloads.retain('request', Buffer.from('replacement'), response(11));
  await assert.rejects(downloads.save(retained.download.responseId));
  assert.equal(await readFile(destination, 'utf8'), 'keep this file'); assert.deepEqual(await readdir(root), ['existing.bin']);
  fail = false; await downloads.save(retained.download.responseId); assert.equal(await readFile(destination, 'utf8'), 'replacement');
});

test('bounds bytes and entries, invalidates replaced responses and releases closed bodies', async context => {
  const root = await directory(context); const downloads = new ResponseDownloadService(async () => join(root, 'body.bin'), { maximumBytes: 6, maximumEntries: 2 });
  const a = downloads.retain('a', Buffer.from('abc'), response(3)); const b = downloads.retain('b', Buffer.from('de'), response(2));
  const c = downloads.retain('c', Buffer.from('fg'), response(2)); assert.deepEqual(c.released, [a.download.responseId]);
  await assert.rejects(downloads.save(a.download.responseId));
  const replacement = downloads.retain('b', Buffer.from('b'), response(1)); assert.deepEqual(replacement.released, [b.download.responseId]);
  assert.deepEqual(downloads.release(c.download.responseId), [c.download.responseId]); assert.deepEqual(downloads.release(c.download.responseId), []);
  const tooLarge = downloads.retain('oversized', Buffer.alloc(7), response(7)); assert.equal(tooLarge.download.available, false);
  assert.equal(downloads.retain('invalid', Buffer.alloc(1), response(2)).download.available, false);
  assert.equal(downloads.retain('failed', Buffer.alloc(0), { ...response(0), error: { type: 'aborted', message: 'cancelled' } }).download.available, false);
  downloads.reset(); await assert.rejects(downloads.save(replacement.download.responseId)); assert.deepEqual(await readdir(root), []);
});

test('does not write a released or reset response after a delayed file picker; guards concurrent dialogs', async context => {
  const root = await directory(context); let pick: (path: string) => void = () => undefined;
  const downloads = new ResponseDownloadService(() => new Promise(resolve => { pick = resolve; }));
  const first = downloads.retain('request', Buffer.from('first'), response(5)); const pending = downloads.save(first.download.responseId);
  await assert.rejects(downloads.save(first.download.responseId)); downloads.release(first.download.responseId); pick(join(root, 'stale.bin'));
  await assert.rejects(pending); assert.deepEqual(await readdir(root), []);
  const second = downloads.retain('request', Buffer.from('second'), response(6)); const reset = downloads.save(second.download.responseId);
  downloads.reset(); pick(join(root, 'reset.bin')); await assert.rejects(reset); assert.deepEqual(await readdir(root), []);
});

test('release during writing aborts before atomic replacement and removes the temporary body', async context => {
  const root = await directory(context); const destination = join(root, 'kept.bin'); await writeFile(destination, 'existing'); let responseId = '';
  const downloads = new ResponseDownloadService(async () => destination, { beforeCommit: async () => { downloads.release(responseId); } });
  responseId = downloads.retain('request', Buffer.from('must not save'), response(13)).download.responseId;
  await assert.rejects(downloads.save(responseId)); assert.equal(await readFile(destination, 'utf8'), 'existing'); assert.deepEqual(await readdir(root), ['kept.bin']);
});

test('suggests bounded MIME-based names without trusting server URLs, headers or paths', () => {
  assert.equal(responseFileName(response(0, 'image', 'image/png')), 'response.png');
  assert.equal(responseFileName(response(0, 'json', 'application/problem+json')), 'response.json');
  assert.equal(responseFileName(response(0, 'binary', 'application/pdf')), 'response.pdf');
  assert.equal(responseFileName(response(0, 'binary', 'application/octet-stream')), 'response.bin');
});

test('validates control-only download messages, response metadata and mutation result ownership', () => {
  assert.equal(validateWebviewMessage({ type: 'saveResponseBody', operationId: 'save', responseId: 'body' }).ok, true);
  assert.equal(validateWebviewMessage({ type: 'saveResponseBody', operationId: 'save', responseId: 'body', path: '/private/file', body: 'synthetic-private-body' }).ok, false);
  assert.equal(validateExtensionMessage({ type: 'response', operationId: 'request', executionId: 'execution', response: { ...response(3), download: { responseId: 'body', available: true } } }).ok, true);
  assert.equal(validateExtensionMessage({ type: 'response', operationId: 'request', executionId: 'execution', response: { ...response(3), download: { responseId: 'body', available: true, bytes: 'forbidden' } } }).ok, false);
  assert.equal(validateExtensionMessage({ type: 'responseDownloadResult', operationId: 'save', responseId: 'body', status: 'saved', fileName: 'body.bin', bytes: 3 }).ok, true);
  assert.equal(validateExtensionMessage({ type: 'responseDownloadResult', operationId: 'save', responseId: 'body', status: 'cancelled', bytes: 0 }).ok, false);
  assert.equal(validateExtensionMessage({ type: 'responseBodiesReleased', operationId: 'released', responseIds: ['body'] }).ok, true);
  assert.equal(validateExtensionMessage({ type: 'error', operationId: 'save', code: 'RESPONSE_BODY_UNAVAILABLE', message: 'Original body expired.' }).ok, true);
  const tracker = new OperationCorrelationTracker(); tracker.record('saveResponseBody', 'save'); tracker.record('getRequest', 'later-query', 'request');
  assert.equal(tracker.isCurrent('save'), true);
});
