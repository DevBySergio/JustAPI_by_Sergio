import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestFileService, withoutRequestFiles } from '../../services/RequestFileService';
import { FILE_UPLOAD_LIMITS, type RequestFile } from '../../models/RequestFile';
import { validateExtensionMessage, validateWebviewMessage } from '../../protocol/MessageValidator';
import { normalizeEffectiveRequest } from '../../engine/http/EffectiveRequest';
import { VariableEngine } from '../../engine/variables/VariableEngine';
import { sanitizeRequestForWebviewState } from '../../webview/WebviewState';
import { createRequestFixture } from '../fixtures/requestFixtures';
import { CodeGenerator } from '../../commands/CodeGenerator';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

async function fixture(context: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'justapi-upload-unit-')); context.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'chosen.bin'); const bytes = Buffer.from([0, 255, 0x80, 13, 10, 0xef, 0xbb, 0xbf]); await writeFile(path, bytes);
  const service = new RequestFileService(async () => path); const file = (await service.select('request'))!;
  const request = createRequestFixture({ id: 'request', url: 'https://example.test', method: 'POST', body: { type: 'binary', content: '', binarySource: 'file', file } });
  return { root, path, bytes, service, file, request };
}

test('reads only selected unchanged files, binds grants to a request, and never exposes paths in metadata or errors', async context => {
  const { path, bytes, service, file, request } = await fixture(context);
  assert.deepEqual(await service.bytes(request.id, file), bytes); assert.deepEqual(await service.validate(request), []);
  assert.doesNotMatch(JSON.stringify(file), /justapi-upload-unit|chosen.bin\//); assert.equal(file.name, 'chosen.bin');
  await assert.rejects(service.bytes('other', file)); await assert.rejects(service.bytes(request.id, { ...file, name: 'other' }));
  assert.equal((await service.validate({ ...request, id: 'other' }))[0].code, 'FILE_NOT_SELECTED');
  await writeFile(path, Buffer.from([0, 255, 0x81, 13, 10, 0xef, 0xbb, 0xbf]));
  assert.equal((await service.validate(request))[0].code, 'FILE_CHANGED');
  await assert.rejects(service.bytes(request.id, file), error => error instanceof Error && !error.message.includes(path));
  const fresh = (await service.select(request.id))!; assert.notEqual(fresh.id, file.id);
  assert.deepEqual(await service.bytes(request.id, fresh), await import('node:fs/promises').then(fs => fs.readFile(path)));
  await rm(path); assert.equal((await service.validate(request))[0].code, 'FILE_UNAVAILABLE');
});

test('rejects directories, oversized files and replacement symlinks; permits empty and exactly 10 MiB files', async context => {
  const { root, path, service, file } = await fixture(context);
  await assert.rejects(new RequestFileService(async () => root).select('request'));
  await truncate(path, FILE_UPLOAD_LIMITS.maximumFileBytes + 1); await assert.rejects(service.select('request'));
  await truncate(path, FILE_UPLOAD_LIMITS.maximumFileBytes); const maximum = (await service.select('request'))!;
  assert.equal((await service.bytes('request', maximum)).length, FILE_UPLOAD_LIMITS.maximumFileBytes);
  await writeFile(path, ''); const empty = (await service.select('request'))!; assert.deepEqual(await service.bytes('request', empty), Buffer.alloc(0));
  const other = join(root, 'other.bin'); await writeFile(other, 'other'); await rm(path); await symlink(other, path);
  await assert.rejects(service.bytes('request', file));
  const explicitlyChosenSymlink = (await service.select('request'))!; assert.equal(explicitlyChosenSymlink.name, 'other.bin');
  service.releaseRequest('request'); await assert.rejects(service.bytes('request', explicitlyChosenSymlink));
});

test('ignores late pickers after replacement, reset and close, including overlapping selection revisions', async context => {
  const { path } = await fixture(context); const picks: Array<(path?: string) => void> = [];
  const files = new RequestFileService(() => new Promise(resolve => picks.push(resolve)));
  const first = files.select('request'); const second = files.select('request'); picks[1](path); const selected = (await second)!;
  const third = files.select('request'); picks[0](path); assert.equal(await first, undefined); picks[2](path); assert.ok(await third);
  const reset = files.select('request'); files.reset(); picks[3](path); assert.equal(await reset, undefined); await assert.rejects(files.bytes('request', selected));
  const close = files.select('request', 'field'); files.releaseRequest('request'); picks[4](path); assert.equal(await close, undefined);
  const cancelled = files.select('request'); picks[5](); assert.equal(await cancelled, undefined);
});

test('strips references from drafts/exports/imports and revalidates saved requests and disabled parts', async context => {
  const { request, service, file } = await fixture(context);
  const multipart = { ...request, body: { type: 'form-data' as const, content: '', files: [{ id: 'field', key: 'upload', enabled: true, file }] } };
  assert.deepEqual(service.forEditor(request).body.file, file);
  assert.equal(service.forEditor({ ...request, id: 'duplicate' }).body.file, undefined);
  assert.equal(withoutRequestFiles(request).body.file, undefined); assert.equal(withoutRequestFiles(multipart).body.files![0].file, undefined);
  assert.doesNotMatch(JSON.stringify(sanitizeRequestForWebviewState(multipart)), new RegExp(file.id));
  const disabled = { ...multipart, body: { ...multipart.body, files: [{ id: 'field', key: 'upload', enabled: false }] } };
  assert.deepEqual(await service.validate(disabled), []); assert.equal(normalizeEffectiveRequest(disabled).body.type, 'form-data');
  service.reset(); assert.equal(service.forEditor(request).body.file, undefined);
});

test('validates both protocol ends, missing selections and MIME types without accepting webview paths or file bytes', async context => {
  const { request, file } = await fixture(context);
  const message = { type: 'selectRequestFile', operationId: 'select', requestId: request.id, fieldId: 'part' };
  assert.equal(validateWebviewMessage(message).ok, true); assert.equal(validateWebviewMessage({ ...message, path: '/private/file' }).ok, false);
  const selected = { type: 'requestFileSelected', operationId: 'select', requestId: request.id, file };
  assert.equal(validateExtensionMessage(selected).ok, true);
  for (const invalid of [{ ...file, path: '/private/file' }, { ...file, name: '../bad' }, { ...file, name: 'bad\r\nheader' }, { ...file, size: -1 }, { ...file, bytes: 'AA==' }]) {
    assert.equal(validateExtensionMessage({ ...selected, file: invalid }).ok, false);
  }
  assert.throws(() => normalizeEffectiveRequest({ ...request, body: { ...request.body, file: undefined } }));
  assert.throws(() => normalizeEffectiveRequest({ ...request, body: { ...request.body, contentType: 'text/plain\r\nX: injected' } }));
  const resolved = new VariableEngine().resolveRequest({ ...request, body: { type: 'form-data', content: '', files: [{ id: 'part', key: '{{FIELD}}', contentType: '{{MIME}}', enabled: true, file }] } }, { globalVars: [], collectionVars: [], requestVars: [] }, { FIELD: 'upload', MIME: 'image/png' });
  assert.equal(resolved.ok, true); assert.equal(resolved.request.body.files![0].key, 'upload'); assert.equal(resolved.request.body.files![0].contentType, 'image/png'); assert.deepEqual(resolved.request.body.files![0].file, file);
});

test('generates seven file recipes without paths/IDs/contents and checks JavaScript, TypeScript, Python, curl and Java syntax plus Go recipe structure', async context => {
  const { root, request, file } = await fixture(context); const generator = new CodeGenerator();
  const variants = [request, { ...request, body: { type: 'form-data' as const, content: '', formData: [{ id: 'text', key: 'title', value: 'a\r\n"ü', enabled: true }], files: [{ id: 'part', key: 'upload', enabled: true, file, contentType: 'image/png' }] } }];
  for (const variant of variants) {
    for (const language of ['javascript', 'typescript', 'python', 'curl', 'csharp', 'java', 'go']) {
      const code = generator.generate(variant, language); assert.doesNotMatch(code, new RegExp(file.id + '|justapi-upload-unit')); assert.doesNotMatch(code, /AQID|base64/);
      if (language === 'javascript' || language === 'typescript') {
        const result = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true }); assert.equal(result.diagnostics?.length, 0);
        new Function(result.outputText);
      } else if (language === 'python') {
        const result = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: code, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
      } else if (language === 'curl') {
        assert.equal(spawnSync('/bin/sh', ['-n'], { input: code }).status, 0);
      } else if (language === 'go') {
        const result = spawnSync('gofmt', [], { input: code, encoding: 'utf8' }); if (result.error && 'code' in result.error && result.error.code === 'ENOENT') { assert.match(code, /func main\(\)/); context.diagnostic('Go formatter unavailable: recipe structure checked; compilation not verified.'); } else { assert.equal(result.status, 0, result.stderr); }
      } else if (language === 'java') {
        const source = join(root, 'ApiRequest.java'); await writeFile(source, code); const result = spawnSync('javac', [source], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
      } else { assert.match(code, /StreamContent\(File.OpenRead/); }
    }
  }
  const invalid: RequestFile = { ...file, size: FILE_UPLOAD_LIMITS.maximumFileBytes + 1 };
  assert.equal(validateExtensionMessage({ type: 'requestFileSelected', operationId: 'select', requestId: request.id, file: invalid }).ok, false);
});

test('resolves only active body fields, so switching to a file or back to text ignores dormant templates', async context => {
  const { request, file } = await fixture(context); const engine = new VariableEngine();
  const contextVars = { globalVars: [], collectionVars: [], requestVars: [] };
  const dormant = { formData: [{ id: 'text', key: 'text', value: '{{UNSET}}', enabled: true }], files: [{ id: 'file', key: '{{UNSET}}', contentType: '{{UNSET}}', enabled: true, file }], contentType: '{{UNSET}}' };
  const binary = engine.resolveRequest({ ...request, body: { ...dormant, ...request.body, content: '{{UNSET}}', contentType: 'application/octet-stream' } }, contextVars);
  assert.equal(binary.ok, true); assert.equal(normalizeEffectiveRequest(binary.request).body.type, 'file');
  const text = engine.resolveRequest({ ...request, body: { ...dormant, type: 'text', content: 'active text' } }, contextVars); assert.equal(text.ok, true);
  const form = engine.resolveRequest({ ...request, body: { type: 'form-data', content: '{{UNSET}}', contentType: '{{UNSET}}', files: [{ id: 'empty', key: '', contentType: '{{UNSET}}', enabled: true }] } }, contextVars); assert.equal(form.ok, true);
});
