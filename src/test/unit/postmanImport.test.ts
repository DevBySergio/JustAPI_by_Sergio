import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parsePostmanExport } from '../../engine/import/PostmanParser';
import { PostmanImportService } from '../../services/PostmanImportService';
import { CollectionService } from '../../services/CollectionService';
import { AuthService } from '../../engine/auth/AuthService';
import { CollectionManager } from '../../engine/collection/CollectionManager';
import { VariableSetManager } from '../../engine/variables/VariableSetManager';
import { JsonFileStore } from '../../storage/JsonFileStore';
import { validateExtensionMessage, validateWebviewMessage } from '../../protocol/MessageValidator';
import { OperationCorrelationTracker } from '../../protocol/CorrelationTracker';
import { postmanCollection, postmanRequest, postmanEnvironment } from '../fixtures/postmanFixtures';

const parse = (value: unknown) => parsePostmanExport(JSON.stringify(value));
async function fixture(context: { after: (callback: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'justapi-postman-')); const path = join(root, 'postman.json');
  let fail = false; const store = new JsonFileStore(root, { beforeRename: async () => { if (fail) { throw new Error('Synthetic disk failure'); } } });
  const secrets = new Map<string, string>(); const auth = new AuthService({ get: async key => secrets.get(key), store: async (key, value) => { secrets.set(key, value); }, delete: async key => { secrets.delete(key); } });
  const collections = new CollectionService(new CollectionManager(store), auth); const sets = new VariableSetManager(store);
  await collections.load(); await sets.load(); const service = new PostmanImportService(collections, sets, async () => path);
  context.after(async () => { service.reset(); await collections.dispose(); await sets.dispose(); await auth.dispose(); await store.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, path, store, secrets, auth, collections, sets, service, failDisk: (value: boolean) => { fail = value; } };
}

test('converts ordered nested folders, inherited auth, noauth, variables, URL objects and form fields', () => {
  const parsed = parse(postmanCollection([{ name: 'Folder', variable: [{ key: 'FOLDER', value: 42 }], item: [
    postmanRequest('One', { method: 'POST', url: { raw: 'https://local.test/items/:id?keep=one&off=two#hash', query: [{ key: 'keep', value: 'one' }, { key: 'off', value: 'two', disabled: true }], variable: [{ key: 'id', value: 'a/b' }] },
      header: [{ key: 'X-Off', value: 'off', disabled: true }], body: { mode: 'urlencoded', urlencoded: [{ key: 'name', value: 'a + b' }] } }),
    postmanRequest('Two', { auth: { type: 'noauth' }, url: { protocol: 'https', host: ['local', 'test'], port: '443', path: ['items', { value: 'next' }] } }),
  ] }], { auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{TOKEN}}' }] }, variable: [{ key: 'BASE', value: 'https://local.test' }] }));
  assert.equal(parsed.preview.requests, 2); assert.equal(parsed.preview.folders, 1); assert.equal(parsed.preview.skippedRequests, 0);
  const [one, two] = parsed.document!.requests;
  assert.equal(one.url, 'https://local.test/items/:id#hash'); assert.equal(one.queryParams[1].enabled, false);
  assert.equal(one.pathParams[0].value, 'a/b'); assert.equal(one.headers[0].enabled, false); assert.equal(one.body.formData![0].value, 'a + b');
  assert.equal(one.variables[0].value, '42'); assert.equal(two.url, 'https://local.test:443/items/next');
  assert.deepEqual(parsed.authInputs.get(one.id), { type: 'bearer', token: '{{TOKEN}}' }); assert.equal(parsed.authInputs.has(two.id), false);
  assert.deepEqual(parsed.document!.collection.items[0].items!.map(item => item.name), ['One', 'Two']);
  assert.notEqual(parse(postmanCollection([postmanRequest()])).document!.collection.id, parsed.document!.collection.id);
});

test('previews omissions without script execution or credential values and skips whole unsupported requests', () => {
  const parsed = parse(postmanCollection([
    postmanRequest('File', { body: { mode: 'file', file: { src: '/private/synthetic-secret' } } }),
    postmanRequest('OAuth', { auth: { type: 'oauth2' } }), postmanRequest('Unsupported', { method: 'TRACE' }), postmanRequest('Socket', { url: 'ws://local.test' }),
    postmanRequest('GraphQL', { body: { mode: 'graphql', graphql: { query: 'synthetic-private-query' } } }),
    { ...postmanRequest('HTTP'), event: [{ listen: 'prerequest', script: { exec: ['throw new Error("synthetic-script-secret")'] } }], response: [{ body: 'synthetic-response-secret' }] },
  ]));
  assert.equal(parsed.preview.requests, 1); assert.equal(parsed.preview.skippedRequests, 5);
  assert.ok(parsed.preview.diagnostics.some(item => item.code === 'SCRIPTS_OMITTED')); assert.ok(parsed.preview.diagnostics.some(item => item.code === 'EXAMPLES_OMITTED'));
  assert.doesNotMatch(JSON.stringify(parsed.preview), /synthetic|private/);
});

test('extracts recognized header and URL credentials, excludes ambiguous auth and never imports redaction placeholders as secrets', () => {
  const parsed = parse(postmanCollection([
    postmanRequest('Bearer', { header: [{ key: 'Authorization', value: 'Bearer synthetic-token' }] }),
    postmanRequest('URL', { url: 'https://user:synthetic%3Apassword@local.test/echo' }),
    postmanRequest('API', { auth: { type: 'apikey', apikey: [{ key: 'key', value: 'secret' }, { key: 'value', value: 'synthetic-api' }, { key: 'in', value: 'query' }] } }),
    postmanRequest('Placeholder', { auth: { type: 'bearer', bearer: [{ key: 'token', value: '<BEARER_TOKEN>' }] } }),
    postmanRequest('Conflict', { header: [{ key: 'Authorization', value: 'Bearer first' }, { key: 'X-API-Key', value: 'second' }] }),
    postmanRequest('Cookie', { header: [{ key: 'Cookie', value: 'session=synthetic-cookie' }] }),
  ]));
  assert.equal(parsed.preview.requests, 4); assert.equal(parsed.preview.credentials, 3); assert.equal(parsed.preview.skippedRequests, 2);
  assert.doesNotMatch(JSON.stringify(parsed.document), /synthetic|user:/);
  assert.equal(parsed.document!.requests[1].url, 'https://local.test/echo');
  assert.deepEqual(parsed.authInputs.get(parsed.document!.requests[1].id), { type: 'basic', username: 'user', password: 'synthetic:password' });
  assert.equal(parsed.authInputs.has(parsed.document!.requests[3].id), false);
});

test('imports environment scalar values and disabled flags; flags secret, duplicate, invalid and oversized variables', () => {
  const parsed = parse(postmanEnvironment([{ key: 'HOST', value: 'local.test', enabled: true }, { key: 'EMPTY', value: '' }, { key: 'OFF', value: false, enabled: false },
    { key: 'SECRET', value: 'synthetic-secret', type: 'secret' }, { key: 'HOST', value: 'duplicate' }, { key: '1bad', value: 'bad' }, { key: 'LARGE', value: 'x'.repeat(65537) }, { key: 'BAD', enabled: 'yes' }]));
  assert.equal(parsed.preview.kind, 'environment'); assert.equal(parsed.preview.variables, 3); assert.equal(parsed.preview.skippedVariables, 5);
  assert.deepEqual(parsed.environment!.map(item => [item.key, item.value, item.enabled]), [['HOST', 'local.test', true], ['EMPTY', '', true], ['OFF', 'false', false]]);
  assert.doesNotMatch(JSON.stringify(parsed.preview), /synthetic-secret|local.test/);
});

test('bounds format, bytes, nesting, items and diagnostics without reflecting source values in errors', () => {
  for (const value of ['bad synthetic-secret', JSON.stringify({ info: { schema: 'https://evil.test/v2.1.0', name: 'bad' }, item: [] }), JSON.stringify(postmanCollection([], { info: { name: 'Old', schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json' } })), 'x'.repeat(10 * 1024 * 1024 + 1)]) {
    assert.throws(() => parsePostmanExport(value), error => !String(error).includes('synthetic'));
  }
  let nested: unknown = postmanRequest(); for (let i = 0; i < 52; i++) { nested = { name: 'Nested', item: [nested] }; }
  assert.throws(() => parse(postmanCollection([nested])));
  assert.throws(() => parse(postmanCollection(Array.from({ length: 10001 }, () => postmanRequest()))));
  const parsed = parse(postmanCollection(Array.from({ length: 201 }, () => postmanRequest('Unsupported', { method: 'TRACE' }))));
  assert.equal(parsed.preview.diagnostics.length, 200); assert.equal(parsed.preview.diagnosticCount, 201);
});

test('stages host-only bytes, verifies reviewed file, requires warnings consent and confirms exactly once', async context => {
  const f = await fixture(context); await writeFile(f.path, JSON.stringify(postmanCollection([postmanRequest()], { event: [{ listen: 'test' }] })));
  const preview = (await f.service.preview())!; assert.equal(f.collections.getCollections().length, 0);
  await assert.rejects(f.service.confirm(preview.previewId, preview.name, false));
  await writeFile(f.path, JSON.stringify(postmanCollection([postmanRequest('Changed')])));
  await assert.rejects(f.service.confirm(preview.previewId, preview.name, true)); assert.equal(f.collections.getCollections().length, 0);
  const current = (await f.service.preview())!;
  const results = await Promise.allSettled([f.service.confirm(current.previewId, 'Imported', false), f.service.confirm(current.previewId, 'Imported', false)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(f.collections.getCollections().length, 1);
  await assert.rejects(f.service.confirm(current.previewId, 'Again', true));
});

test('rolls back imported secrets and collection state on a disk failure and supports a retry', async context => {
  const f = await fixture(context); await writeFile(f.path, JSON.stringify(postmanCollection([postmanRequest('Auth', { auth: { type: 'basic', basic: [{ key: 'username', value: 'local-user' }, { key: 'password', value: 'synthetic-persisted-secret' }] } })])));
  const preview = (await f.service.preview())!; assert.doesNotMatch(JSON.stringify(preview), /synthetic-persisted-secret|local-user/);
  f.failDisk(true); await assert.rejects(f.service.confirm(preview.previewId, 'Safe', false));
  assert.equal(f.secrets.size, 0); assert.equal(f.collections.getCollections().length, 0);
  f.failDisk(false); await f.service.confirm(preview.previewId, 'Safe', false); assert.equal(f.secrets.size, 1);
  const collection = f.collections.getCollections()[0]; const request = f.collections.getRequest(f.collections.getRequestsForCollection(collection.id)[0].id)!;
  assert.equal(request.auth.type, 'basic'); assert.doesNotMatch(await readFile(join(f.root, 'collections.json'), 'utf8'), /synthetic-persisted-secret|local-user/);
  const resolved = await f.auth.resolveForTransport(request, f.collections.getPersistedRequest(request.id));
  assert.equal(resolved.headers[0].value, 'Basic ' + Buffer.from('local-user:synthetic-persisted-secret').toString('base64'));
});

test('adds environments inactive, preserves selection, and cancellation/reset leave no imported state', async context => {
  const f = await fixture(context); const selected = await f.sets.create('Existing', 'environment'); await f.sets.selectEnvironment(selected.id);
  await writeFile(f.path, JSON.stringify(postmanEnvironment([{ key: 'HOST', value: 'local.test' }])));
  const preview = (await f.service.preview())!; await f.service.confirm(preview.previewId, 'Imported', false);
  assert.equal(f.sets.getActiveEnvironment()?.id, selected.id); assert.equal(f.sets.getAll()[1].active, false);
  const cancelled = (await f.service.preview())!; f.service.cancel(cancelled.previewId); await assert.rejects(f.service.confirm(cancelled.previewId, 'Cancelled', true));
  const reset = (await f.service.preview())!; f.service.reset(); await assert.rejects(f.service.confirm(reset.previewId, 'Reset', true)); assert.equal(f.sets.getAll().length, 2);
  await writeFile(f.path, Buffer.from([0xff])); await assert.rejects(f.service.preview());
  const directory = new PostmanImportService(f.collections, f.sets, async () => f.root); await assert.rejects(directory.preview());
});

test('validates both protocol ends strictly and lets import mutation acknowledgements survive later queries', () => {
  const preview = { ...parse(postmanCollection()).preview, previewId: 'preview', fileName: 'collection.json' };
  assert.equal(validateExtensionMessage({ type: 'postmanImportPreview', operationId: 'preview-op', preview }).ok, true);
  assert.equal(validateExtensionMessage({ type: 'postmanImportPreview', operationId: 'preview-op', preview: { ...preview, document: 'synthetic-secret' } }).ok, false);
  assert.equal(validateWebviewMessage({ type: 'previewPostmanImport', operationId: 'preview-op' }).ok, true);
  assert.equal(validateWebviewMessage({ type: 'previewPostmanImport', operationId: 'preview-op', path: '/private/file' }).ok, false);
  assert.equal(validateWebviewMessage({ type: 'confirmPostmanImport', operationId: 'confirm-op', previewId: 'preview', name: 'Import', acceptWarnings: true }).ok, true);
  const tracker = new OperationCorrelationTracker(); tracker.record('getCollections', 'old'); tracker.record('confirmPostmanImport', 'confirm'); tracker.record('getCollections', 'new');
  assert.equal(tracker.isCurrent('old'), false); assert.equal(tracker.isCurrent('confirm'), true);
});

test('rejects obsolete picker results and never creates a stage after a view reset', async context => {
  const f = await fixture(context); await writeFile(f.path, JSON.stringify(postmanCollection([postmanRequest()])));
  const selections: Array<(path: string) => void> = [];
  const service = new PostmanImportService(f.collections, f.sets, () => new Promise(resolve => selections.push(resolve)));
  const old = service.preview(); const current = service.preview(); selections[1](f.path);
  assert.ok(await current); selections[0](f.path); assert.equal(await old, undefined);
  const reset = service.preview(); service.reset(); selections[2](f.path); assert.equal(await reset, undefined);
  assert.equal(f.collections.getCollections().length, 0);
});

test('excludes invalid literal HTTP and path/header data while preserving supported text-only multipart', () => {
  const parsed = parse(postmanCollection([
    postmanRequest('Invalid URL', { url: 'http://[broken' }), postmanRequest('Empty URL', { url: '' }),
    postmanRequest('Invalid header', { header: [{ key: 'Header\nInjected', value: 'value' }] }),
    postmanRequest('Raw without mode', { body: { raw: 'cannot silently drop this body' } }),
    postmanRequest('Multipart', { method: 'POST', body: { mode: 'formdata', formdata: [{ key: 'text', value: 'hello', type: 'text' }, { key: 'file', type: 'file', src: '/never/read', disabled: true }] } }),
    postmanRequest('Multipart file', { body: { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: '/never/read' }] } }),
  ]));
  assert.equal(parsed.preview.skippedRequests, 5); assert.equal(parsed.preview.requests, 1);
  assert.equal(parsed.document!.requests[0].body.type, 'form-data'); assert.equal(parsed.document!.requests[0].body.formData![1].enabled, false);
});


test('protects credentials in variable-protocol URLs and bounds expansion from inherited folder variables', () => {
  const parsed = parse(postmanCollection([
    postmanRequest('Variable URL', { url: '{{protocol}}://user:synthetic-variable-password@{{host}}/echo' }),
    postmanRequest('Redacted URL', { url: '{{protocol}}://user:%3CREDACTED%3E@{{host}}/echo' }),
  ]));
  assert.equal(parsed.preview.credentials, 1); assert.equal(parsed.preview.requests, 2);
  assert.doesNotMatch(JSON.stringify(parsed.document), /synthetic-variable-password|user:/);
  assert.equal(parsed.document!.requests[0].url, '{{protocol}}://{{host}}/echo');
  assert.ok(parsed.preview.diagnostics.some(value => value.code === 'AUTH_PLACEHOLDER'));
  assert.throws(() => parse(postmanCollection([{ name: 'Expanded', variable: Array.from({ length: 500 }, (_, index) => ({ key: `VAR${index}`, value: 'value' })),
    item: Array.from({ length: 1000 }, () => postmanRequest()) }])));
});
