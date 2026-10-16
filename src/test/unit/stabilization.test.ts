import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { CollectionManager } from '../../engine/collection/CollectionManager';
import { VariableSetManager } from '../../engine/variables/VariableSetManager';
import { CollectionService } from '../../services/CollectionService';
import { HistoryService } from '../../services/HistoryService';
import { RequestService } from '../../services/RequestService';
import type { RequestPreparation } from '../../services/RequestPreparationService';
import { JsonFileStore } from '../../storage/JsonFileStore';
import { normalizeHistoryData } from '../../storage/HistorySummary';
import type { JustResponse } from '../../models/Response';
import { createRequestFixture } from '../fixtures/requestFixtures';

const response: JustResponse = {
  statusCode: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: {},
  body: '', bodyType: 'text', size: 0, duration: 1, timings: { total: 1 },
  cookies: [], redirected: false,
};

describe('October stabilization regressions', () => {
  test('keeps concurrent collection mutations and preserves a saved request location', async context => {
    const directory = mkdtempSync(join(tmpdir(), 'justapi-concurrency-'));
    const store = new JsonFileStore(directory);
    context.after(async () => { await store.dispose(); rmSync(directory, { recursive: true, force: true }); });
    const manager = new CollectionManager(store);
    await manager.load();
    await Promise.all([manager.createCollection('First'), manager.createCollection('Second')]);
    assert.deepEqual(manager.getCollections().map(c => c.name), ['First', 'Second']);
    const collection = manager.getCollections()[0];
    const folder = await manager.addFolder(collection.id, 'Folder');
    assert.ok(folder);
    const first = createRequestFixture({ id: 'first-nested' });
    const second = createRequestFixture({ id: 'second-nested' });
    await manager.saveRequest(first, collection.id, folder.id);
    await manager.saveRequest(second, collection.id, folder.id);
    await manager.saveRequest({ ...first, name: 'Edited' }, collection.id);
    const items = manager.getCollection(collection.id)?.items;
    assert.equal(items?.length, 1);
    assert.deepEqual(items?.[0].items?.map(item => item.requestId), [first.id, second.id]);
    const reloaded = new CollectionManager(store);
    await reloaded.load();
    assert.deepEqual(reloaded.getCollections(), manager.getCollections());
  });

  test('serializes history read-modify-write including clear and record', async context => {
    const directory = mkdtempSync(join(tmpdir(), 'justapi-history-concurrency-'));
    const store = new JsonFileStore(directory, { dataTransforms: { history: normalizeHistoryData } });
    context.after(async () => { await store.dispose(); rmSync(directory, { recursive: true, force: true }); });
    const history = new HistoryService(store);
    const request = createRequestFixture();
    await Promise.all([
      history.record(request, response, { hasSavedRequest: false }),
      history.record(request, response, { hasSavedRequest: false }),
    ]);
    assert.equal((await history.list()).length, 2);
    await Promise.all([history.clear(), history.record(request, response, { hasSavedRequest: false })]);
    assert.equal((await history.list()).length, 1);
  });

  test('does not publish variable sets when persistence fails', async context => {
    const directory = mkdtempSync(join(tmpdir(), 'justapi-set-rollback-'));
    let fail = false;
    const store = new JsonFileStore(directory, { beforeRename: () => { if (fail) { throw new Error('disk failure'); } } });
    context.after(async () => { await store.dispose(); rmSync(directory, { recursive: true, force: true }); });
    const manager = new VariableSetManager(store);
    const saved = await manager.create('Saved');
    fail = true;
    await assert.rejects(manager.create('Failed'));
    await assert.rejects(manager.update({ ...saved, name: 'Failed edit' }));
    assert.deepEqual(manager.getAll(), [saved]);
    const copy = manager.getAll();
    copy[0].name = 'External mutation';
    assert.equal(manager.getAll()[0].name, 'Saved');
  });

  test('never starts transport after cancellation or disposal during preparation', async () => {
    for (const stage of ['variables', 'credentials'] as const) {
      for (const action of ['cancel', 'dispose'] as const) {
        const request = createRequestFixture();
        let release!: () => void;
        let entered!: () => void;
        const suspended = new Promise<void>(resolve => { release = resolve; });
        const preparing = new Promise<void>(resolve => { entered = resolve; });
        const preparation = {
          resolve: async () => {
            if (stage === 'variables') { entered(); await suspended; }
            return { ok: true, request, diagnostics: [] };
          },
          resolveForTransport: async () => {
            if (stage === 'credentials') { entered(); await suspended; }
            return request;
          },
        } as unknown as RequestPreparation;
        let sent = 0;
        const service = new RequestService(
          preparation, {} as CollectionService, {} as HistoryService, undefined,
          () => ({ cancel: () => undefined, execute: async () => { sent++; return response; } })
        );
        const running = service.execute({ type: 'executeRequest', operationId: 'operation', executionId: 'execution', request }, () => undefined);
        await preparing;
        if (action === 'cancel') { service.cancel('cancel-operation', 'execution', () => undefined); }
        else { service.dispose(); }
        release();
        await running;
        assert.equal(sent, 0, `${action} during ${stage}`);
      }
    }
  });
});
