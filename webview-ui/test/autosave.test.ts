import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { VariableAutosave } from '../src/utils/VariableAutosave';

const variables = [{ id: 'v', key: 'key', value: 'first', enabled: true, scope: 'global' as const }];

describe('variable autosave transactions', () => {
  test('retains newer edits made while a previous snapshot awaits acknowledgement', async () => {
    let release!: () => void;
    const first = new Promise<void>(resolve => { release = resolve; });
    const sent: string[] = [];
    const autosave = new VariableAutosave(async message => {
      sent.push(message.variables[0].value);
      if (sent.length === 1) { await first; }
    }, error => { throw error; });
    autosave.scheduleGlobal(variables);
    const running = autosave.flush();
    autosave.scheduleGlobal([{ ...variables[0], value: 'latest' }]);
    release();
    await running;
    await autosave.flush();
    assert.deepEqual(sent, ['first', 'latest']);
  });

  test('retains failed saves for retry and keeps collection and global domains independent', async () => {
    let fail = true;
    const sent: string[] = [];
    const autosave = new VariableAutosave(async message => {
      if (fail) { throw new Error('write failed'); }
      sent.push(message.type);
    }, () => undefined);
    autosave.scheduleGlobal(variables);
    autosave.scheduleCollection('global', variables);
    await assert.rejects(autosave.flush());
    assert.equal(autosave.overlayGlobal([]).length, 1);
    fail = false;
    await autosave.flush();
    assert.deepEqual(sent, ['setGlobalVariables', 'setCollectionVariables']);
    assert.deepEqual(autosave.overlayGlobal([]), []);
  });
});
