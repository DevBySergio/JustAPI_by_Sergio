import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { CollectionManager } from '../../engine/collection/CollectionManager';
import { JsonFileStore } from '../../storage/JsonFileStore';
import { createRequestFixture } from '../fixtures/requestFixtures';
import {
  collectionRoundTripFixture,
  concurrentWriteFixture,
  corruptStorageDocument,
} from '../fixtures/storageFixtures';

function createTemporaryStore(): { directory: string; store: JsonFileStore } {
  const directory = mkdtempSync(join(tmpdir(), 'justapi-store-test-'));
  return { directory, store: new JsonFileStore(directory) };
}

describe('JsonFileStore and CollectionManager', () => {
  test('flushes queued writes and reads them from a new store', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));

    await Promise.all([
      store.write('first', concurrentWriteFixture.first),
      store.write('second', concurrentWriteFixture.second),
    ]);
    await store.flush();

    const reloaded = new JsonFileStore(directory);
    assert.deepEqual(await reloaded.read('first'), concurrentWriteFixture.first);
    assert.deepEqual(await reloaded.read('second'), concurrentWriteFixture.second);
  });

  test('returns null for a corrupt JSON fixture without leaking parser errors', async context => {
    const { directory, store } = createTemporaryStore();
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, 'corrupt.json'), corruptStorageDocument, 'utf8');

    assert.equal(await store.read('corrupt'), null);
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
});
