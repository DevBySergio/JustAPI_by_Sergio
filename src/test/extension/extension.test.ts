import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { CommandResult } from '../../commands/CommandController';
import { COMMANDS } from '../../constants';
import { regressionFixtures } from '../fixtures/regressionFixtures';

suite('JustAPI extension host', () => {
  test('activates at the declared VS Code engine floor', async () => {
    const extension = vscode.extensions.all.find(candidate => (
      candidate.packageJSON.name === 'justapi' && candidate.packageJSON.publisher === 'DevBySergio'
    ));

    assert.ok(extension, 'The JustAPI extension must be installed in the test host');
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  test('registers every contributed command', async () => {
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'justapi');
    assert.ok(extension);
    await extension.activate();
    const availableCommands = new Set(await vscode.commands.getCommands(true));

    const contributedCommands = (extension.packageJSON.contributes.commands as Array<{ command: string }>)
      .map(contribution => contribution.command);
    assert.deepEqual([...contributedCommands].sort(), Object.values(COMMANDS).sort());
    for (const command of contributedCommands) {
      assert.ok(availableCommands.has(command), `Expected command to be registered: ${command}`);
    }
  });

  test('delivers cold and warm startup commands through the contributed webview', async () => {
    const coldResult = await vscode.commands.executeCommand<CommandResult>(COMMANDS.CREATE_REQUEST);
    assert.equal(coldResult?.status, 'completed');

    const warmResult = await vscode.commands.executeCommand<CommandResult>(COMMANDS.OPEN_HISTORY);
    assert.equal(warmResult?.status, 'completed');

    await vscode.commands.executeCommand('workbench.action.closeSidebar');
  });

  test('tracks deferred startup and protocol contracts explicitly', () => {
    const fixtureIds = new Set(regressionFixtures.map(fixture => fixture.id));
    assert.ok(fixtureIds.has('command-startup-queue'));
    assert.ok(fixtureIds.has('protocol-errors'));
    assert.ok(fixtureIds.has('stale-responses'));
    assert.ok(fixtureIds.has('webview-resilience'));
  });
});
