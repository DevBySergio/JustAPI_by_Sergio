import * as assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { CollectionManager } from '../../engine/collection/CollectionManager';
import { CollectionIntegrityError } from '../../engine/collection/CollectionGraph';
import type { HistoryEntry } from '../../models/HistoryEntry';
import type { StorageEnvelope } from '../../storage/JsonFileStore';
import {
  JsonFileStore,
  STORAGE_SCHEMA_VERSION,
  StorageError,
} from '../../storage/JsonFileStore';
import { HISTORY_LIMITS, normalizeHistoryData } from '../../storage/HistorySummary';
import { createRequestFixture } from '../fixtures/requestFixtures';
import { COLLECTION_TRANSFER_SCHEMA_VERSION } from '../../models/CollectionTransfer';
import { validateCollectionImportDocument } from '../../protocol/MessageValidator';
import {
  collectionRoundTripFixture,
  concurrentWriteFixture,
  corruptStorageDocument,
} from '../fixtures/storageFixtures';

function createTemporaryStore(
  options: ConstructorParameters<typeof JsonFileStore>[1] = {}
): { directory: string; store: JsonFileStore } {
  const directory = mkdtempSync(join(tmpdir(), 'justapi-store-test-'));
  return { directory, store: new JsonFileStore(directory, options) };
}

function readEnvelope<T>(directory: string, key: string): StorageEnvelope<T> {
  return JSON.parse(readFileSync(join(directory, `${key}.json`), 'utf8')) as StorageEnvelope<T>;
}

function readAllFiles(directory: string): string {
  const visit = (current: string): string => readdirSync(current, { withFileTypes: true })
    .map(entry => entry.isDirectory()
      ? visit(join(current, entry.name))
      : readFileSync(join(current, entry.name), 'utf8'))
    .join('\n');
  return visit(directory);
}

function isStorageError(error: unknown, code: StorageError['code']): boolean {
  return error instanceof StorageError && error.code === code;
}

function isCollectionError(error: unknown, code: string): boolean {
  return error instanceof CollectionIntegrityError
    && error.issues.some(issue => issue.code === code);
}

describe('JsonFileStore and CollectionManager', () => {
  test('durably serializes queued writes in versioned envelopes', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));

    await Promise.all([
      store.write('first', concurrentWriteFixture.first),
      store.write('second', concurrentWriteFixture.second),
    ]);
    await store.flush();

    const first = readEnvelope<typeof concurrentWriteFixture.first>(directory, 'first');
    assert.equal(first.schemaVersion, STORAGE_SCHEMA_VERSION);
    assert.equal(first.revision, 1);
    assert.ok(first.updatedAt > 0);

    const reloaded = new JsonFileStore(directory);
    assert.deepEqual(await reloaded.read('first'), concurrentWriteFixture.first);
    assert.deepEqual(await reloaded.read('second'), concurrentWriteFixture.second);
  });

  test('migrates legacy JSON once and journals a verified v1 backup', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, 'legacy.json'), JSON.stringify(concurrentWriteFixture.first), 'utf8');

    assert.deepEqual(await store.read('legacy'), concurrentWriteFixture.first);
    const migrated = readEnvelope<typeof concurrentWriteFixture.first>(directory, 'legacy');
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.revision, 1);

    const backups = readdirSync(join(directory, 'backups'));
    assert.equal(backups.filter(name => name.startsWith('legacy.v1.')).length, 1);
    const journalBefore = readFileSync(join(directory, 'migration-journal.json'), 'utf8');
    assert.match(journalBefore, /"status": "completed"/);

    assert.deepEqual(await store.read('legacy'), concurrentWriteFixture.first);
    assert.deepEqual(readdirSync(join(directory, 'backups')), backups);
  });

  test('preserves a legacy domain field named schemaVersion', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const legacySettings = { schemaVersion: 1, theme: 'dark' };
    writeFileSync(join(directory, 'settings.json'), JSON.stringify(legacySettings), 'utf8');

    assert.deepEqual(await store.read('settings'), legacySettings);
    assert.deepEqual(readEnvelope<typeof legacySettings>(directory, 'settings').data, legacySettings);
  });

  test('rejects a stale writer instead of overwriting a newer window revision', async context => {
    const { directory, store: seed } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    await seed.write('shared', { value: 'seed' });

    const firstWindow = new JsonFileStore(directory);
    const secondWindow = new JsonFileStore(directory);
    await Promise.all([firstWindow.read('shared'), secondWindow.read('shared')]);
    await firstWindow.write('shared', { value: 'first-window' });

    await assert.rejects(
      secondWindow.write('shared', { value: 'stale-window' }),
      error => isStorageError(error, 'STORAGE_CONFLICT')
    );
    assert.equal(secondWindow.getStatus('shared').readOnly, true);
    assert.deepEqual(await new JsonFileStore(directory).read('shared'), { value: 'first-window' });
  });

  test('keeps the previous revision when interrupted before atomic rename', async context => {
    const { directory, store: seed } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    await seed.write('interrupted', { value: 'stable' });

    const failing = new JsonFileStore(directory, {
      beforeRename: () => {
        throw new Error('simulated interruption');
      },
    });
    await failing.read('interrupted');
    await assert.rejects(
      failing.write('interrupted', { value: 'not-committed' }),
      error => isStorageError(error, 'COMMIT_FAILED')
    );

    assert.deepEqual(await new JsonFileStore(directory).read('interrupted'), { value: 'stable' });
    assert.equal(readdirSync(directory).some(name => name.includes('.tmp-')), false);
  });

  test('leaves legacy data intact and read-only when migration cannot commit', async context => {
    const { directory } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, 'legacy-failure.json'), JSON.stringify({ value: 'legacy' }), 'utf8');
    const store = new JsonFileStore(directory, {
      beforeRename: () => {
        throw new Error('simulated migration failure');
      },
    });

    assert.equal(await store.read('legacy-failure'), null);
    assert.equal(store.getStatus('legacy-failure').readOnly, true);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'legacy-failure.json'), 'utf8')), {
      value: 'legacy',
    });
    assert.ok(readdirSync(join(directory, 'backups')).some(name => name.startsWith('legacy-failure.v1.')));
  });

  test('quarantines corruption only after restoring a verified backup', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    await store.write('recoverable', { value: 'revision-one' });
    await store.write('recoverable', { value: 'revision-two' });
    writeFileSync(join(directory, 'recoverable.json'), corruptStorageDocument, 'utf8');

    const recoveredStore = new JsonFileStore(directory);
    assert.deepEqual(await recoveredStore.read('recoverable'), { value: 'revision-one' });
    assert.equal(recoveredStore.getStatus('recoverable').readOnly, false);
    assert.equal(recoveredStore.getStatus('recoverable').lastFailure?.recovered, true);
    assert.equal(readdirSync(join(directory, 'quarantine')).length, 1);
  });

  test('preserves unrecoverable corruption and enters visible read-only mode', async context => {
    const failures: string[] = [];
    const { directory, store } = createTemporaryStore({
      onFailure: failure => failures.push(failure.code),
    });
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, 'corrupt.json'), corruptStorageDocument, 'utf8');

    assert.equal(await store.read('corrupt'), null);
    assert.equal(store.getStatus('corrupt').readOnly, true);
    assert.equal(existsSync(join(directory, 'corrupt.json')), true);
    assert.deepEqual(failures, ['CORRUPT_DOCUMENT']);
    await assert.rejects(
      store.write('corrupt', { replacement: true }),
      error => isStorageError(error, 'READ_ONLY')
    );
  });

  test('does not downgrade unsupported future schemas', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const future = { schemaVersion: 99, revision: 8, updatedAt: Date.now(), data: { value: true } };
    writeFileSync(join(directory, 'future.json'), JSON.stringify(future), 'utf8');

    assert.equal(await store.read('future'), null);
    assert.equal(store.getStatus('future').lastFailure?.code, 'UNSUPPORTED_SCHEMA');
    assert.equal(store.getStatus('future').readOnly, true);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'future.json'), 'utf8')), future);
  });

  test('reclaims only a stale lock whose owning process is absent', async context => {
    const { directory } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const lockPath = join(directory, '.storage.lock');
    writeFileSync(lockPath, JSON.stringify({
      pid: 2_000_000_000,
      sessionId: 'dead-session',
      token: 'dead-token',
      acquiredAt: 1,
    }), 'utf8');
    utimesSync(lockPath, new Date(0), new Date(0));

    const store = new JsonFileStore(directory, { staleLockMs: 1, lockTimeoutMs: 100 });
    assert.equal(await store.read('empty'), null);
    assert.equal(existsSync(lockPath), false);
  });

  test('times out without stealing a lock from a live process', async context => {
    const { directory } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const lockPath = join(directory, '.storage.lock');
    writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      sessionId: 'live-session',
      token: 'live-token',
      acquiredAt: 1,
    }), 'utf8');
    utimesSync(lockPath, new Date(0), new Date(0));

    const store = new JsonFileStore(directory, { staleLockMs: 1, lockTimeoutMs: 30 });
    await assert.rejects(
      store.read('blocked'),
      error => isStorageError(error, 'LOCK_TIMEOUT')
    );
    assert.equal(existsSync(lockPath), true);
  });

  test('rejects payloads over the configured byte limit without creating a file', async context => {
    const { directory, store } = createTemporaryStore({ maximumDocumentBytes: 256 });
    context.after(() => rmSync(directory, { recursive: true, force: true }));

    await assert.rejects(
      store.write('oversized', { value: 'x'.repeat(512) }),
      error => isStorageError(error, 'DOCUMENT_TOO_LARGE')
    );
    assert.equal(existsSync(join(directory, 'oversized.json')), false);
  });

  test('ignores orphan temporary files and flushes accepted work during disposal', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const pending = store.write('shutdown', { persisted: true });
    await store.dispose();
    await pending;
    writeFileSync(join(directory, '.shutdown.tmp-dead-window'), '{"partial":', 'utf8');

    assert.deepEqual(await new JsonFileStore(directory).read('shutdown'), { persisted: true });
  });

  test('migrates history to redacted summaries with count and byte caps', async context => {
    const fixtureSecret = 'history-secret-marker';
    const { directory, store } = createTemporaryStore({
      dataTransforms: { history: normalizeHistoryData },
    });
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const request = createRequestFixture({
      url: `https://fixture.test/path?token=${fixtureSecret}`,
      headers: [{ id: 'authorization', key: 'Authorization', value: fixtureSecret, enabled: true }],
      body: { type: 'json', content: fixtureSecret },
    });
    const response = {
      statusCode: 200,
      statusText: 'OK',
      httpVersion: '1.1',
      headers: { 'content-type': 'application/json', 'set-cookie': fixtureSecret },
      body: fixtureSecret,
      bodyType: 'json' as const,
      size: 1024,
      duration: 12,
      cookies: [{ name: 'session', value: fixtureSecret }],
      redirected: false,
    };
    writeFileSync(join(directory, 'history.json'), JSON.stringify([{
      id: 'legacy-history-entry',
      request,
      response,
      timestamp: Date.now(),
      duration: response.duration,
      statusCode: response.statusCode,
      url: request.url,
      method: request.method,
    }]), 'utf8');

    const migrated = await store.read<HistoryEntry[]>('history');
    assert.equal(migrated?.length, 1);
    assert.match(migrated?.[0].url ?? '', /redacted/);
    assert.equal(migrated?.[0].contentType, 'application/json');
    assert.equal(Object.prototype.hasOwnProperty.call(migrated?.[0] ?? {}, 'request'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(migrated?.[0] ?? {}, 'response'), false);
    assert.doesNotMatch(readAllFiles(directory), new RegExp(fixtureSecret));

    const manyEntries = Array.from({ length: 250 }, (_, index) => ({
      ...migrated?.[0],
      id: `history-${index}`,
      timestamp: index,
      url: `https://fixture.test/${'x'.repeat(15_000)}?token=value-${index}`,
    }));
    const bounded = normalizeHistoryData(manyEntries);
    assert.ok(bounded.length <= HISTORY_LIMITS.maximumEntries);
    assert.ok(Buffer.byteLength(`${JSON.stringify({
      schemaVersion: 2,
      revision: Number.MAX_SAFE_INTEGER,
      updatedAt: Number.MAX_SAFE_INTEGER,
      data: bounded,
    }, null, 2)}\n`, 'utf8') <= HISTORY_LIMITS.maximumEnvelopeBytes);
  });

  test('quarantines a malformed history entry after selecting a safe backup', async context => {
    const { directory, store } = createTemporaryStore({
      dataTransforms: { history: normalizeHistoryData },
    });
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const first: HistoryEntry = {
      id: 'history-safe-first',
      timestamp: 1,
      duration: 5,
      statusCode: 200,
      url: 'https://fixture.test/first',
      method: 'GET',
      responseSize: 12,
    };
    const second: HistoryEntry = { ...first, id: 'history-safe-second', timestamp: 2 };
    await store.write('history', [first]);
    await store.write('history', [second, first]);
    writeFileSync(join(directory, 'history.json'), JSON.stringify([{ malformed: true }]), 'utf8');

    const recovered = new JsonFileStore(directory, {
      dataTransforms: { history: normalizeHistoryData },
    });
    assert.deepEqual(await recovered.read('history'), [first]);
    assert.equal(recovered.getStatus('history').lastFailure?.recovered, true);
    assert.equal(readdirSync(join(directory, 'quarantine')).length, 1);
  });

  test('round-trips a nested collection and request through persisted storage', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const manager = new CollectionManager(store);
    const collection = await manager.createCollection(collectionRoundTripFixture.collectionName);
    const folder = await manager.addFolder(collection.id, collectionRoundTripFixture.folderName);
    assert.ok(folder);

    const request = createRequestFixture({
      name: collectionRoundTripFixture.requestName,
      url: 'https://fixture.test/round-trip',
    });
    await manager.saveRequest(request, collection.id, folder.id);
    await store.flush();

    const reloaded = new CollectionManager(new JsonFileStore(directory));
    await reloaded.load();
    const loadedCollection = reloaded.getCollection(collection.id);

    assert.equal(reloaded.getRequest(request.id)?.url, request.url);
    assert.equal(loadedCollection?.items[0].items?.[0].requestId, request.id);
  });

  test('rejects invalid parents and descendant moves without changing state', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const manager = new CollectionManager(store);
    const collection = await manager.createCollection('Transactional tree');
    const parent = await manager.addFolder(collection.id, 'Parent');
    assert.ok(parent);
    const child = await manager.addFolder(collection.id, 'Child', parent.id);
    assert.ok(child);
    const request = createRequestFixture({ name: 'Owned request' });
    await manager.saveRequest(request, collection.id, child.id);
    const before = {
      collections: manager.getCollections(),
      requests: manager.getRequests(),
    };

    await assert.rejects(
      manager.moveItem(request.id, collection.id, collection.id, 'missing-parent'),
      error => isCollectionError(error, 'INVALID_PARENT')
    );
    await assert.rejects(
      manager.moveItem(parent.id, collection.id, collection.id, child.id),
      error => isCollectionError(error, 'DESTINATION_IS_DESCENDANT')
    );
    assert.deepEqual({
      collections: manager.getCollections(),
      requests: manager.getRequests(),
    }, before);

    const invalid = manager.getCollection(collection.id);
    assert.ok(invalid);
    invalid.items.push({ ...invalid.items[0] });
    await assert.rejects(
      manager.updateCollection(invalid),
      error => isCollectionError(error, 'DUPLICATE_ITEM_ID')
    );
    assert.deepEqual(manager.getCollections(), before.collections);
  });

  test('reorders staged items and cascades collection deletion without orphaning requests', async context => {
    const removedRequestIds: string[] = [];
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const manager = new CollectionManager(store, {
      afterRemove: async removed => {
        removedRequestIds.push(...removed.map(request => request.id));
      },
    });
    const removable = await manager.createCollection('Removable');
    const first = await manager.addFolder(removable.id, 'First');
    const second = await manager.addFolder(removable.id, 'Second');
    assert.ok(first);
    assert.ok(second);
    const owned = createRequestFixture({ name: 'Cascade me' });
    await manager.saveRequest(owned, removable.id, first.id);

    await manager.moveItem(second.id, removable.id, removable.id, undefined, 0);
    assert.deepEqual(
      manager.getCollection(removable.id)?.items.map(item => item.name),
      ['Second', 'First']
    );

    const retained = await manager.createCollection('Retained');
    const retainedRequest = createRequestFixture({ name: 'Keep me' });
    await manager.saveRequest(retainedRequest, retained.id);
    await manager.deleteCollection(removable.id);

    assert.deepEqual(removedRequestIds, [owned.id]);
    assert.equal(manager.getRequest(owned.id), undefined);
    assert.equal(manager.getRequest(retainedRequest.id)?.name, 'Keep me');
    const reloaded = new CollectionManager(new JsonFileStore(directory));
    await reloaded.load();
    assert.deepEqual(reloaded.getCollections().map(collection => collection.name), ['Retained']);
  });

  test('rejects colliding imports before persistence and preserves canonical bytes', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const manager = new CollectionManager(store);
    const collection = await manager.createCollection('Existing export');
    const request = createRequestFixture({ name: 'Existing request' });
    await manager.saveRequest(request, collection.id);
    const importedCollection = manager.getCollection(collection.id);
    assert.ok(importedCollection);
    const beforeState = {
      collections: manager.getCollections(),
      requests: manager.getRequests(),
    };
    const beforeBytes = readFileSync(join(directory, 'collections.json'), 'utf8');

    await assert.rejects(
      manager.importCollection(importedCollection, [request]),
      error => isCollectionError(error, 'DUPLICATE_COLLECTION_ID')
        && isCollectionError(error, 'DUPLICATE_REQUEST_ID')
    );
    assert.deepEqual({
      collections: manager.getCollections(),
      requests: manager.getRequests(),
    }, beforeState);
    assert.equal(readFileSync(join(directory, 'collections.json'), 'utf8'), beforeBytes);
  });

  test('keeps in-memory and persisted collection state unchanged when commit fails', async context => {
    let rejectCommit = false;
    const { directory, store } = createTemporaryStore({
      beforeRename: key => {
        if (rejectCommit && key === 'collections') {
          throw new Error('simulated collection commit failure');
        }
      },
    });
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const manager = new CollectionManager(store);
    const collection = await manager.createCollection('Stable collection');
    const beforeState = manager.getCollections();
    const beforeBytes = readFileSync(join(directory, 'collections.json'), 'utf8');

    rejectCommit = true;
    await assert.rejects(
      manager.addFolder(collection.id, 'Must not appear'),
      error => isStorageError(error, 'COMMIT_FAILED')
    );
    assert.deepEqual(manager.getCollections(), beforeState);
    assert.equal(readFileSync(join(directory, 'collections.json'), 'utf8'), beforeBytes);
  });

  test('round-trips a versioned deep export with hierarchy, order, variables, and requests intact', async context => {
    const source = createTemporaryStore();
    const destination = createTemporaryStore();
    context.after(() => {
      rmSync(source.directory, { recursive: true, force: true });
      rmSync(destination.directory, { recursive: true, force: true });
    });
    const sourceManager = new CollectionManager(source.store);
    const collection = await sourceManager.createCollection('Deep export');
    const rootA = await sourceManager.addFolder(collection.id, 'Root A');
    const rootB = await sourceManager.addFolder(collection.id, 'Root B');
    assert.ok(rootA);
    assert.ok(rootB);
    const childA1 = await sourceManager.addFolder(collection.id, 'Child A1', rootA.id);
    const childA2 = await sourceManager.addFolder(collection.id, 'Child A2', rootA.id);
    assert.ok(childA1);
    assert.ok(childA2);
    const firstRequest = createRequestFixture({ id: 'request-deep-first', name: 'First' });
    const secondRequest = createRequestFixture({ id: 'request-deep-second', name: 'Second' });
    await sourceManager.saveRequest(firstRequest, collection.id, childA2.id);
    await sourceManager.saveRequest(secondRequest, collection.id, rootB.id);
    const withVariables = sourceManager.getCollection(collection.id);
    assert.ok(withVariables);
    withVariables.variables = [{
      id: 'variable-deep-export',
      key: 'baseUrl',
      value: 'https://fixture.test',
      enabled: true,
      scope: 'collection',
    }];
    await sourceManager.updateCollection(withVariables);

    const exportedCollection = sourceManager.getCollection(collection.id);
    assert.ok(exportedCollection);
    const exportedRequests = sourceManager.getRequestsForCollection(collection.id)
      .map(request => ({ ...request, auth: { type: 'none' } as const }));
    const validation = validateCollectionImportDocument(JSON.stringify({
      schemaVersion: COLLECTION_TRANSFER_SCHEMA_VERSION,
      collection: exportedCollection,
      requests: exportedRequests,
    }));
    if (!validation.ok) {
      assert.fail(validation.message);
    }
    assert.equal(validation.ok, true);

    const destinationManager = new CollectionManager(destination.store);
    await destinationManager.importCollection(validation.value.collection, validation.value.requests);
    assert.deepEqual(destinationManager.getCollection(collection.id), exportedCollection);
    assert.deepEqual(
      destinationManager.getRequestsForCollection(collection.id).map(request => request.id),
      ['request-deep-first', 'request-deep-second']
    );
  });

  test('reports cyclic imports without cloning or persisting them', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const manager = new CollectionManager(store);
    const collection = await manager.createCollection('Cycle guard');
    const cyclic = manager.getCollection(collection.id);
    assert.ok(cyclic);
    const folder = {
      type: 'folder' as const,
      id: 'cyclic-folder',
      name: 'Cyclic folder',
      items: [] as typeof cyclic.items,
    };
    folder.items.push(folder);
    cyclic.items.push(folder);
    const beforeBytes = readFileSync(join(directory, 'collections.json'), 'utf8');

    await assert.rejects(
      manager.importCollection(cyclic, []),
      error => isCollectionError(error, 'CYCLIC_ITEM_GRAPH')
    );
    assert.equal(readFileSync(join(directory, 'collections.json'), 'utf8'), beforeBytes);
  });
});
