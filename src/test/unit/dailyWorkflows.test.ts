import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test, type TestContext } from 'node:test';
import { AuthService, type SecretStorageLike } from '../../engine/auth/AuthService';
import { CollectionManager } from '../../engine/collection/CollectionManager';
import { CollectionIntegrityError } from '../../engine/collection/CollectionGraph';
import { EffectiveRequestError, normalizeEffectiveRequest } from '../../engine/http/EffectiveRequest';
import { VariableEngine } from '../../engine/variables/VariableEngine';
import { VariableSetManager } from '../../engine/variables/VariableSetManager';
import { CodeGenerator } from '../../commands/CodeGenerator';
import { CollectionService } from '../../services/CollectionService';
import { CodeGenerationService } from '../../services/CodeGenerationService';
import { PersistenceService } from '../../services/PersistenceService';
import { RequestPreparationService } from '../../services/RequestPreparationService';
import { JsonFileStore, type JsonFileStoreOptions } from '../../storage/JsonFileStore';
import { validateWebviewMessage } from '../../protocol/MessageValidator';
import { WebviewMessageRouter, WebviewProtocol } from '../../protocol/WebviewProtocol';
import { WebviewMessageHandler, type WebviewMessageHandlerOptions } from '../../webview/WebviewMessageHandler';
import type { CodeTargetLanguage, ExtensionMessage } from '../../models/MessageProtocol';
import { createRequestFixture } from '../fixtures/requestFixtures';

class Secrets implements SecretStorageLike {
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.values.get(key); }
  async store(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

async function fixture(context: TestContext, options?: JsonFileStoreOptions) {
  const directory = mkdtempSync(join(tmpdir(), 'justapi-daily-'));
  const store = new JsonFileStore(directory, options);
  const secrets = new Secrets();
  const auth = new AuthService(secrets);
  const manager = new CollectionManager(store, { afterRemove: (removed, remaining) => auth.cleanupRemovedRequests(removed, remaining) });
  const collections = new CollectionService(manager, auth);
  const persistence = new PersistenceService(store, store);
  const preparation = new RequestPreparationService(new VariableEngine(), collections, new VariableSetManager(store), persistence, auth);
  context.after(async () => { await collections.dispose(); await auth.dispose(); await store.dispose(); rmSync(directory, { recursive: true, force: true }); });
  await collections.load();
  await collections.createCollection('First');
  await collections.createCollection('Second');
  return { store, secrets, auth, manager, collections, persistence, preparation };
}

describe('daily collection and request workflows', () => {
  test('moves nested folders and reorders siblings without changing IDs or later save positions', async context => {
    const { collections, manager, store } = await fixture(context);
    const [first, second] = collections.getCollections();
    await collections.createFolder(first.id, 'Parent');
    const parent = collections.getCollection(first.id)!.items[0];
    await collections.createFolder(first.id, 'Child', parent.id);
    const child = collections.getCollection(first.id)!.items[0].items![0];
    const requests = ['A', 'B', 'C'].map(id => createRequestFixture({ id, name: id }));
    for (const request of requests) { await collections.saveRequest(request, first.id, child.id); }
    await Promise.all([
      collections.renameFolder(first.id, child.id, 'Renamed'),
      collections.createFolder(first.id, 'Concurrent'),
    ]);
    await collections.moveItem('A', first.id, first.id, child.id, 2);
    await collections.moveItem(parent.id, first.id, second.id, undefined, 0);
    await collections.saveRequest({ ...requests[1], name: 'Updated B' }, second.id);
    const tree = collections.getCollection(second.id)!.items[0];
    assert.equal(tree.id, parent.id);
    assert.equal(tree.items![0].id, child.id);
    assert.equal(tree.items![0].name, 'Renamed');
    assert.deepEqual(tree.items![0].items!.map(item => [item.id, item.name]), [['B', 'Updated B'], ['C', 'C'], ['A', 'A']]);
    assert.equal(collections.getCollection(first.id)!.items[0].name, 'Concurrent');
    const reloaded = new CollectionManager(store);
    await reloaded.load();
    assert.deepEqual(reloaded.getCollections(), manager.getCollections());
    assert.deepEqual(reloaded.getRequests(), manager.getRequests());
  });

  test('rejects descendant moves and preserves the tree and secrets on disk failure before cascading deletion', async context => {
    let fail = false;
    const { collections, secrets, manager } = await fixture(context, { beforeRename: () => { if (fail) { throw new Error('disk failure'); } } });
    const collection = collections.getCollections()[0];
    await collections.createFolder(collection.id, 'Parent');
    const parent = collections.getCollection(collection.id)!.items[0];
    await collections.createFolder(collection.id, 'Child', parent.id);
    const child = collections.getCollection(collection.id)!.items[0].items![0];
    const request = createRequestFixture({ id: 'cascade' });
    request.auth = await collections.configureAuth(request.id, { type: 'bearer', token: 'synthetic-saved' });
    await collections.saveRequest(request, collection.id, child.id);
    await collections.configureAuth(request.id, { type: 'bearer', token: 'synthetic-pending' });
    const outside = createRequestFixture({ id: 'outside' });
    outside.auth = await collections.configureAuth(outside.id, { type: 'bearer', token: 'synthetic-outside' });
    await collections.saveRequest(outside, collection.id);
    const before = manager.getCollections();
    await assert.rejects(collections.moveItem(parent.id, collection.id, collection.id, child.id), CollectionIntegrityError);
    await assert.rejects(collections.renameFolder(collection.id, outside.id, 'Not a folder'), CollectionIntegrityError);
    fail = true;
    await assert.rejects(collections.deleteFolder(collection.id, parent.id));
    await assert.rejects(collections.renameFolder(collection.id, parent.id, 'Not saved'));
    assert.deepEqual(manager.getCollections(), before);
    assert.equal(secrets.values.size, 3);
    assert.equal(collections.hasPendingAuth(request.id), true);
    fail = false;
    await collections.deleteFolder(collection.id, parent.id);
    assert.equal(manager.getRequest(request.id), undefined);
    assert.ok(manager.getRequest(outside.id));
    assert.equal(collections.hasPendingAuth(request.id), false);
    assert.deepEqual([...secrets.values.values()].map(value => JSON.parse(value).token), ['synthetic-outside']);
  });

  test('validates and dispatches folder mutations with correlated snapshots and acknowledgements', async context => {
    const { collections } = await fixture(context);
    const collectionId = collections.getCollections()[0].id;
    const sent: ExtensionMessage[] = [];
    const protocol = new WebviewProtocol(message => sent.push(message));
    const handler = new WebviewMessageHandler({ collections, protocol } as WebviewMessageHandlerOptions);
    const router = new WebviewMessageRouter(protocol, message => handler.dispatch(message));
    await router.handle({ type: 'createFolder', operationId: 'create-folder', collectionId, name: 'Folder' });
    const folderId = collections.getCollection(collectionId)!.items[0].id;
    await router.handle({ type: 'renameFolder', operationId: 'rename-folder', collectionId, folderId, name: 'Renamed' });
    assert.equal(collections.getCollection(collectionId)!.items[0].name, 'Renamed');
    await router.handle({ type: 'deleteFolder', operationId: 'delete-folder', collectionId, folderId });
    assert.equal(collections.getCollection(collectionId)!.items.length, 0);
    assert.deepEqual(sent.map(message => [message.type, message.operationId]), [
      ['collections', 'create-folder'], ['acknowledgement', 'create-folder'],
      ['collections', 'rename-folder'], ['acknowledgement', 'rename-folder'],
      ['collections', 'delete-folder'], ['acknowledgement', 'delete-folder'],
    ]);
    for (const payload of [
      { type: 'createFolder', name: '   ' }, { type: 'createFolder', name: 'F', parentId: '../invalid id' },
      { type: 'renameFolder', folderId, name: '' }, { type: 'deleteFolder', folderId, cascade: false },
    ]) { assert.equal(validateWebviewMessage({ ...payload, operationId: 'invalid', collectionId }).ok, false); }
  });

  test('encodes complete path segments while leaving authority, literal colons and query values intact', () => {
    const request = createRequestFixture({ url: 'http://[::1]:8080/users/:id/:id/time:zone?literal=:id#fragment',
      pathParams: [{ id: 'id', name: 'id', value: 'a/b ?#%ñ' }] });
    const expected = 'http://[::1]:8080/users/a%2Fb%20%3F%23%25%C3%B1/a%2Fb%20%3F%23%25%C3%B1/time:zone?literal=:id';
    assert.equal(normalizeEffectiveRequest(request).url, expected);
    assert.equal(request.url.includes('/:id'), true);
    for (const pathParams of [[], [{ id: 'a', name: 'id', value: '' }], [{ id: 'a', name: 'id', value: '..' }],
      [{ id: 'a', name: 'id', value: '.' }], [{ id: 'a', name: 'id', value: '\ud800' }],
      [{ id: 'a', name: 'id', value: 'one' }, { id: 'b', name: 'id', value: 'two' }]]) {
      assert.throws(() => normalizeEffectiveRequest({ ...request, pathParams }),
        error => error instanceof EffectiveRequestError && error.code === 'INVALID_PATH_PARAMETER');
    }
  });

  test('uses request scope consistently in preview, transport and all code targets and blocks missing path values', async context => {
    const { collections, auth, persistence, preparation } = await fixture(context);
    const collectionId = collections.getCollections()[0].id;
    await persistence.saveVariables([{ id: 'global', key: 'user', value: 'global', enabled: true, scope: 'global' }]);
    await collections.updateCollectionVariables(collectionId, [{ id: 'collection', key: 'user', value: 'collection', enabled: true, scope: 'collection' }]);
    const request = createRequestFixture({ url: 'https://example.test/users/:id', pathParams: [{ id: 'path', name: 'id', value: '{{user}}' }],
      variables: [{ id: 'request', key: 'user', value: 'request/ñ', enabled: true, scope: 'request' }] });
    const expected = 'https://example.test/users/request%2F%C3%B1';
    assert.equal((await preparation.preview(request, collectionId)).resolvedUrl, expected);
    assert.equal(normalizeEffectiveRequest(await preparation.resolveForTransport(request, collectionId)).url, expected);
    const code = new CodeGenerationService(new CodeGenerator(), preparation, collections, auth, async () => false);
    for (const language of ['javascript', 'typescript', 'python', 'curl', 'csharp', 'java', 'go'] as CodeTargetLanguage[]) {
      assert.ok((await code.generate(request, language, collectionId)).code.includes(expected), language);
    }
    request.variables[0].enabled = false;
    assert.equal((await preparation.preview(request, collectionId)).resolvedUrl, 'https://example.test/users/collection');
    request.pathParams = [];
    const preview = await preparation.preview(request, collectionId);
    assert.equal(preview.canExecute, false);
    assert.deepEqual(preview.diagnostics, [{ code: 'INVALID_PATH_PARAMETER', location: 'pathParams' }]);
    await assert.rejects(preparation.resolveForTransport(request, collectionId));
    await assert.rejects(code.generate(request, 'curl', collectionId));
  });
});
