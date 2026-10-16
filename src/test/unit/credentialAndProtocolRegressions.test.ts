import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test, TestContext } from 'node:test';
import { AuthService, SecretStorageLike } from '../../engine/auth/AuthService';
import { CollectionManager } from '../../engine/collection/CollectionManager';
import { VariableEngine } from '../../engine/variables/VariableEngine';
import { VariableSetManager } from '../../engine/variables/VariableSetManager';
import { CodeGenerator } from '../../commands/CodeGenerator';
import { CollectionService } from '../../services/CollectionService';
import { PersistenceService } from '../../services/PersistenceService';
import { RequestPreparationService } from '../../services/RequestPreparationService';
import { JsonFileStore, JsonFileStoreOptions } from '../../storage/JsonFileStore';
import { OperationCorrelationTracker } from '../../protocol/CorrelationTracker';
import { validateExtensionMessage, validateWebviewMessage } from '../../protocol/MessageValidator';
import { WebviewProtocol } from '../../protocol/WebviewProtocol';
import { WebviewMessageHandler, WebviewMessageHandlerOptions } from '../../webview/WebviewMessageHandler';
import { createDefaultCollection } from '../../models/Collection';
import type { AuthInput } from '../../models/Auth';
import type { ExtensionMessage } from '../../models/MessageProtocol';
import { createRequestFixture } from '../fixtures/requestFixtures';

class Secrets implements SecretStorageLike {
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.values.get(key); }
  async store(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}
async function fixture(context: TestContext, options?: JsonFileStoreOptions) {
  const directory = mkdtempSync(join(tmpdir(), 'justapi-auth-regression-'));
  const store = new JsonFileStore(directory, options);
  const secrets = new Secrets();
  const auth = new AuthService(secrets);
  const manager = new CollectionManager(store);
  const collections = new CollectionService(manager, auth);
  context.after(async () => { await auth.dispose(); await store.dispose(); rmSync(directory, { recursive: true, force: true }); });
  await collections.load();
  return { store, auth, secrets, collections };
}

describe('credential and protocol regressions', () => {
  test('redacts URL credentials from default collection derivatives and every snippet target', () => {
    const request = createRequestFixture({ url: 'https://synthetic-user:synthetic-password@example.test/path' });
    const auth = new AuthService(new Secrets());
    const derivative = auth.redactForDerivative(request);
    assert.equal(derivative.url, 'https://example.test/path');
    assert.equal(derivative.headers[0].value, 'Basic <BASIC_CREDENTIALS>');
    const generator = new CodeGenerator();
    for (const language of ['javascript', 'typescript', 'python', 'curl', 'csharp', 'java', 'go']) {
      const code = generator.generate(request, language);
      assert.doesNotMatch(code, /synthetic-user|synthetic-password/);
      assert.match(code, /BASIC_CREDENTIALS/);
    }
    assert.match(generator.generate(request, 'curl', { credentialRepresentation: 'resolved' }), /synthetic-password/);
  });

  test('retains pending auth until save, supports discard, and permits retry after a failed commit', async context => {
    let fail = false;
    const { collections, auth } = await fixture(context, { beforeRename: () => { if (fail) { throw new Error('disk failure'); } } });
    await collections.createCollection('Auth');
    const collectionId = collections.getCollections()[0].id;
    const request = createRequestFixture();
    request.auth = await collections.configureAuth(request.id, { type: 'bearer', token: 'synthetic-first' });
    await collections.saveRequest(request, collectionId);
    const original = collections.getRequest(request.id)!;
    const updatedAuth = await collections.configureAuth(request.id, { type: 'bearer', token: 'synthetic-second' });
    assert.equal(collections.hasPendingAuth(request.id), true);
    assert.deepEqual(collections.getRequest(request.id), original);
    const exportedSaved = await collections.exportDocument(collectionId, true, async () => true);
    assert.match(exportedSaved.json, /synthetic-first/);
    assert.doesNotMatch(exportedSaved.json, /synthetic-second/);
    await collections.discardRequestChanges(request.id);
    assert.equal(collections.hasPendingAuth(request.id), false);
    assert.equal((await auth.resolveForTransport(original, collections.getPersistedRequest(request.id))).headers.at(-1)?.value, 'Bearer synthetic-first');
    await collections.configureAuth(request.id, { type: 'bearer', token: 'synthetic-second' });
    fail = true;
    await assert.rejects(collections.saveRequest({ ...original, auth: updatedAuth }, collectionId));
    assert.equal(collections.hasPendingAuth(request.id), true);
    fail = false;
    await collections.saveRequest({ ...original, auth: updatedAuth }, collectionId);
    assert.equal(collections.hasPendingAuth(request.id), false);
    assert.equal((await auth.resolveForTransport(original, collections.getPersistedRequest(request.id))).headers.at(-1)?.value, 'Bearer synthetic-second');
  });

  test('drains an accepted credential save before secret disposal and rejects late writes', async context => {
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const committing = new Promise<void>(resolve => { entered = resolve; });
    let suspend = false;
    const { collections, auth, secrets } = await fixture(context, { beforeRename: async () => {
      if (suspend) { entered(); await blocked; }
    } });
    await collections.createCollection('Shutdown');
    const request = createRequestFixture({ url: 'https://example.test' });
    request.auth = await collections.configureAuth(request.id, { type: 'bearer', token: 'synthetic-shutdown' });
    suspend = true;
    const saving = collections.saveRequest(request, collections.getCollections()[0].id);
    await committing;
    const closing = collections.dispose().then(() => auth.dispose());
    await assert.rejects(collections.createCollection('Too late'));
    release();
    await Promise.all([saving, closing]);
    assert.equal(secrets.values.size, 1);
    const persisted = collections.getPersistedRequest(request.id)!;
    assert.equal((await auth.resolveForTransport(auth.toPublicRequest(persisted), persisted)).headers.at(-1)?.value, 'Bearer synthetic-shutdown');
  });

  test('round-trips disclosed Bearer, Basic, and custom API keys into the importing SecretStorage', async context => {
    const source = await fixture(context);
    const target = await fixture(context);
    const redactedTarget = await fixture(context);
    await source.collections.createCollection('Portable credentials');
    const collectionId = source.collections.getCollections()[0].id;
    const inputs: AuthInput[] = [
      { type: 'bearer', token: 'synthetic-bearer' },
      { type: 'basic', username: 'synthetic-user', password: 'synthetic-password' },
      { type: 'apiKey', name: 'X-Custom', in: 'header', value: 'synthetic-header-key' },
      { type: 'apiKey', name: 'custom_key', in: 'query', value: 'synthetic-query-key' },
    ];
    for (const input of inputs) {
      const request = createRequestFixture();
      request.auth = await source.collections.configureAuth(request.id, input);
      await source.collections.saveRequest(request, collectionId);
    }
    const exported = await source.collections.exportDocument(collectionId, true, async () => true);
    await target.collections.importDocument(exported.json);
    const imported = target.collections.getRequestsForCollection(collectionId);
    const expectedValues = ['Bearer synthetic-bearer', `Basic ${Buffer.from('synthetic-user:synthetic-password').toString('base64')}`, 'synthetic-header-key', 'synthetic-query-key'];
    for (let index = 0; index < imported.length; index++) {
      assert.equal(imported[index].auth.type, inputs[index].type);
      const request = target.auth.toPublicRequest(imported[index]);
      const delivered = await target.auth.resolveForTransport(request, imported[index]);
      assert.ok([...delivered.headers, ...delivered.queryParams].some(pair => pair.key === (inputs[index].type === 'apiKey' ? (inputs[index] as Extract<AuthInput, { type: 'apiKey' }>).name : 'Authorization')));
      assert.ok([...delivered.headers, ...delivered.queryParams].some(pair => pair.value === expectedValues[index]));
    }
    const disk = JSON.stringify(await target.store.read('collections'));
    assert.doesNotMatch(disk, /synthetic-(bearer|password|header-key|query-key)/);
    assert.equal(target.secrets.values.size, 4);
    await assert.rejects(target.collections.importDocument(exported.json));
    assert.equal(target.secrets.values.size, 4);
    const safeExport = await source.collections.exportDocument(collectionId, false, async () => false);
    await redactedTarget.collections.importDocument(safeExport.json);
    assert.equal(redactedTarget.secrets.values.size, 0);
    assert.ok(redactedTarget.collections.getRequestsForCollection(collectionId).every(request => request.auth.type === 'none'));
  });

  test('allows supported large requests and domains while retaining small control-message limits', () => {
    const request = createRequestFixture({ body: { type: 'text', content: 'x'.repeat(1024 * 1024) } });
    assert.equal(validateWebviewMessage({ type: 'executeRequest', operationId: 'large-request', executionId: 'large-execution', request }).ok, true);
    const collection = createDefaultCollection('Large collection');
    collection.variables = Array.from({ length: 20 }, (_, index) => ({ id: `v${index}`, key: `v${index}`, value: 'x'.repeat(60000), enabled: true, scope: 'collection' }));
    assert.equal(validateExtensionMessage({ type: 'collections', operationId: 'large-domain', collections: [collection] }).ok, true);
    assert.equal(validateWebviewMessage({ type: 'getSettings', operationId: 'control', extra: 'x'.repeat(1024 * 1024) }).ok, false);
  });

  test('never supersedes mutation confirmations with later reads or mutations', () => {
    const tracker = new OperationCorrelationTracker();
    tracker.record('saveRequest', 'save');
    tracker.record('createCollection', 'create');
    tracker.record('getCollections', 'refresh');
    assert.equal(tracker.isCurrent('save'), true);
    assert.equal(tracker.isCurrent('create'), true);
    tracker.record('getCollections', 'new-refresh');
    assert.equal(tracker.isCurrent('refresh'), false);
  });

  test('validates URLs and headers consistently before preview, execution, and code generation', async context => {
    const { collections, auth, store } = await fixture(context);
    const preparation = new RequestPreparationService(new VariableEngine(), collections, new VariableSetManager(store), new PersistenceService(store, store), auth);
    for (const request of [
      createRequestFixture({ url: 'not a URL' }),
      createRequestFixture({ headers: [{ id: 'invalid', key: 'X-Invalid', value: 'bad\nvalue', enabled: true }] }),
    ]) {
      const preview = await preparation.preview(request);
      assert.equal(preview.canExecute, false);
      assert.ok(preview.diagnostics.some(value => value.code === 'INVALID_URL' || value.code === 'INVALID_HEADER'));
      await assert.rejects(preparation.resolveForTransport(request));
    }
    const conflict = createRequestFixture({ url: 'https://example.test?key=ordinary', auth: { type: 'apiKey', name: 'key', in: 'query', configured: true } });
    const preview = await preparation.preview(conflict);
    assert.equal(preview.canExecute, false);
    assert.equal(preview.diagnostics[0].code, 'AUTH_CONFLICT');
    assert.doesNotMatch(preview.resolvedUrl, /ordinary/);
  });

  test('delivers initial domains separately before marking the webview ready', async () => {
    const sent: ExtensionMessage[] = [];
    let ready = false;
    const options = {
      protocol: new WebviewProtocol(message => sent.push(message)),
      collections: { load: async () => undefined, getCollections: () => [] },
      variableSets: { load: async () => undefined, getAll: () => [] },
      history: { list: async () => [] },
      persistence: { loadVariables: async () => [], loadSettings: async () => ({}) },
      startupActions: { setReady: () => { ready = true; } },
    } as unknown as WebviewMessageHandlerOptions;
    await new WebviewMessageHandler(options).dispatch({ type: 'webviewReady', operationId: 'startup' });
    assert.deepEqual(sent.map(message => message.type), ['collections', 'history', 'variables', 'variableSets', 'settings', 'initializationComplete']);
    assert.equal(ready, true);
    ready = false;
    options.persistence.loadVariables = async () => Array.from({ length: 1001 }, (_, index) => ({ id: `v${index}`, key: `v${index}`, value: '', enabled: true, scope: 'global' }));
    await assert.rejects(new WebviewMessageHandler(options).dispatch({ type: 'webviewReady', operationId: 'invalid-startup' }));
    assert.equal(ready, false);
  });
});
