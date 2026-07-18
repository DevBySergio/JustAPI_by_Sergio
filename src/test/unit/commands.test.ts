import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  CommandCollection,
  CommandController,
  CommandEnvironment,
  CommandExport,
  CommandOperationError,
  CommandStartupAction,
  CommandTarget,
} from '../../commands/CommandController';
import { StartupActionQueue } from '../../commands/StartupActionQueue';
import { COMMANDS } from '../../constants';

class FakeCommandTarget implements CommandTarget {
  readonly actions: Array<{ action: CommandStartupAction; operationId: string }> = [];
  collections: CommandCollection[] = [{ id: 'collection-fixture', name: 'Fixture', requestCount: 2 }];
  exportData: CommandExport = {
    collectionId: 'collection-fixture',
    name: 'Fixture',
    json: '{"schemaVersion":2}',
  };
  importedCollectionId = 'collection-imported';
  importError?: Error;

  async runStartupAction(action: CommandStartupAction, operationId: string): Promise<void> {
    this.actions.push({ action, operationId });
  }

  async getCommandCollections(): Promise<CommandCollection[]> {
    return this.collections;
  }

  async exportCollectionForCommand(): Promise<CommandExport> {
    return this.exportData;
  }

  async importCollectionForCommand(): Promise<{ collectionId: string }> {
    if (this.importError) {
      throw this.importError;
    }
    return { collectionId: this.importedCollectionId };
  }
}

interface FakeEnvironmentState {
  clipboard: string;
  pickedCollectionId?: string;
  openedFile?: string;
  saveResult: boolean;
  openViewCount: number;
  saved?: { name: string; contents: string };
}

function createEnvironment(state: FakeEnvironmentState): CommandEnvironment {
  return {
    openView: async () => { state.openViewCount += 1; },
    readClipboard: async () => state.clipboard,
    pickCollection: async () => state.pickedCollectionId,
    openCollectionFile: async () => state.openedFile,
    saveCollectionFile: async (name, contents) => {
      state.saved = { name, contents };
      return state.saveResult;
    },
  };
}

function createState(overrides: Partial<FakeEnvironmentState> = {}): FakeEnvironmentState {
  return {
    clipboard: '/usr/bin/curl https://fixture.test',
    pickedCollectionId: 'collection-fixture',
    openedFile: '{"schemaVersion":2}',
    saveResult: true,
    openViewCount: 0,
    ...overrides,
  };
}

function operationFactory(): () => string {
  let index = 0;
  return () => `operation-command-${++index}`;
}

async function nextTurn(): Promise<void> {
  await new Promise<void>(resolveTurn => setImmediate(resolveTurn));
}

describe('command registration and startup delivery', () => {
  test('keeps the command constants exactly aligned with manifest contributions', () => {
    const packageJson = JSON.parse(readFileSync(
      resolve(__dirname, '../../../package.json'),
      'utf8'
    )) as { contributes: { commands: Array<{ command: string }> } };
    const contributed = packageJson.contributes.commands.map(entry => entry.command).sort();
    const declared = Object.values(COMMANDS).sort();
    assert.deepEqual(declared, contributed);
    assert.equal(new Set(declared).size, declared.length);
  });

  test('queues a cold action until ready and delivers warm actions exactly once', async () => {
    const delivered: Array<{ operationId: string; action: string }> = [];
    const queue = new StartupActionQueue<string>(async (operationId, action) => {
      delivered.push({ operationId, action });
      return true;
    }, 1_000);

    const cold = queue.enqueue('operation-cold', 'newRequest');
    await nextTurn();
    assert.deepEqual(delivered, []);

    queue.setReady(true);
    await nextTurn();
    assert.deepEqual(delivered, [{ operationId: 'operation-cold', action: 'newRequest' }]);
    queue.setReady(true);
    await nextTurn();
    assert.equal(delivered.length, 1);
    assert.equal(queue.complete('operation-cold'), true);
    await cold;

    const warm = queue.enqueue('operation-warm', 'showHistory');
    await nextTurn();
    assert.equal(delivered.length, 2);
    assert.equal(queue.complete('operation-warm'), true);
    await warm;
    assert.equal(queue.pendingCount, 0);
  });

  test('rejects pending actions on disposal and never delivers them later', async () => {
    let deliveryCount = 0;
    const queue = new StartupActionQueue<string>(async () => {
      deliveryCount += 1;
      return true;
    });
    const pending = queue.enqueue('operation-disposed', 'showVariables');
    queue.dispose();
    await assert.rejects(pending, /disposed before the startup action completed/);
    queue.setReady(true);
    await nextTurn();
    assert.equal(deliveryCount, 0);
    assert.equal(queue.pendingCount, 0);
  });

  test('redelivers an unacknowledged action once when the webview target is replaced', async () => {
    const deliveries: string[] = [];
    const queue = new StartupActionQueue<string>(async operationId => {
      deliveries.push(operationId);
      return true;
    }, 1_000);
    queue.setReady(true);
    const pending = queue.enqueue('operation-reload', 'showCollections');
    await nextTurn();
    assert.deepEqual(deliveries, ['operation-reload']);

    queue.resetForNewTarget();
    queue.setReady(true);
    await nextTurn();
    assert.deepEqual(deliveries, ['operation-reload', 'operation-reload']);
    queue.setReady(true);
    await nextTurn();
    assert.equal(deliveries.length, 2);
    assert.equal(queue.complete('operation-reload'), true);
    await pending;
  });

  test('routes every navigation command and clipboard cURL to real startup actions', async () => {
    const target = new FakeCommandTarget();
    const state = createState();
    const controller = new CommandController(target, createEnvironment(state), operationFactory());

    const results = await Promise.all([
      controller.createRequest(),
      controller.importCurl(),
      controller.openHistory(),
      controller.createVariable(),
      controller.generateCode(),
    ]);

    assert.ok(results.every(result => result.status === 'completed'));
    assert.deepEqual(target.actions.map(entry => entry.action.type), [
      'newRequest',
      'showHistory',
      'showVariables',
      'showCodeGeneration',
      'importCurl',
    ]);
    assert.equal(state.openViewCount, 5);
  });

  test('uses validated provider data for export and import before navigating collections', async () => {
    const target = new FakeCommandTarget();
    const state = createState();
    const controller = new CommandController(target, createEnvironment(state), operationFactory());

    const exported = await controller.exportCollection();
    const imported = await controller.importCollection();

    assert.equal(exported.status, 'completed');
    assert.equal(imported.status, 'completed');
    assert.deepEqual(state.saved, { name: 'Fixture', contents: '{"schemaVersion":2}' });
    assert.deepEqual(target.actions.map(entry => entry.action), [
      { type: 'showCollections', collectionId: 'collection-fixture' },
      { type: 'showCollections', collectionId: 'collection-imported' },
    ]);
  });

  test('returns correlated cancellation and actionable error results', async () => {
    const target = new FakeCommandTarget();
    const cancelledState = createState({ pickedCollectionId: undefined, openedFile: undefined });
    const cancelled = new CommandController(
      target,
      createEnvironment(cancelledState),
      operationFactory()
    );
    assert.equal((await cancelled.exportCollection()).status, 'cancelled');
    assert.equal((await cancelled.importCollection()).status, 'cancelled');

    const invalidClipboard = new CommandController(
      target,
      createEnvironment(createState({ clipboard: '   ' })),
      operationFactory()
    );
    const clipboardResult = await invalidClipboard.importCurl();
    assert.equal(clipboardResult.status, 'failed');
    if (clipboardResult.status === 'failed') {
      assert.equal(clipboardResult.error.code, 'INVALID_CLIPBOARD');
      assert.match(clipboardResult.operationId, /^operation-command-/);
    }

    const oversizedEnvironment = createEnvironment(createState());
    oversizedEnvironment.openCollectionFile = async () => {
      throw new CommandOperationError(
        'INVALID_IMPORT',
        'The selected collection file exceeds the import limit.'
      );
    };
    const oversizedImport = await new CommandController(
      target,
      oversizedEnvironment,
      operationFactory()
    ).importCollection();
    assert.equal(oversizedImport.status, 'failed');
    if (oversizedImport.status === 'failed') {
      assert.equal(oversizedImport.error.code, 'INVALID_IMPORT');
    }

    target.importError = new CommandOperationError(
      'INVALID_IMPORT',
      'The selected fixture is invalid.',
      ['DUPLICATE_COLLECTION_ID: collection-fixture']
    );
    const invalidImport = new CommandController(
      target,
      createEnvironment(createState()),
      operationFactory()
    );
    const importResult = await invalidImport.importCollection();
    assert.equal(importResult.status, 'failed');
    if (importResult.status === 'failed') {
      assert.equal(importResult.error.code, 'INVALID_IMPORT');
      assert.deepEqual(importResult.error.details, [
        'DUPLICATE_COLLECTION_ID: collection-fixture',
      ]);
    }
  });
});
