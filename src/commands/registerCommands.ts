import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'node:util';
import { COMMANDS, ViewId } from '../constants';
import { JustAPIWebviewProvider } from '../webview/JustAPIWebviewProvider';
import {
  CommandController,
  CommandOperationError,
  CommandResult,
} from './CommandController';
import { PROTOCOL_LIMITS } from '../protocol/MessageValidator';

const OPEN_JUSTAPI_VIEW_COMMAND = `workbench.view.extension.${ViewId.ACTIVITY_CONTAINER}`;

export function registerCommands(
  context: vscode.ExtensionContext,
  provider: JustAPIWebviewProvider
): void {
  const controller = new CommandController(provider, {
    openView: async () => {
      await vscode.commands.executeCommand(OPEN_JUSTAPI_VIEW_COMMAND);
    },
    readClipboard: async () => await vscode.env.clipboard.readText(),
    pickCollection: async (collections) => {
      const picked = await vscode.window.showQuickPick(
        collections.map(collection => ({
          label: collection.name,
          description: `${collection.requestCount} request${collection.requestCount === 1 ? '' : 's'}`,
          collectionId: collection.id,
        })),
        {
          title: 'Export JustAPI Collection',
          placeHolder: 'Select a collection to export',
        }
      );
      return picked?.collectionId;
    },
    openCollectionFile: async () => {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Import Collection',
        filters: { 'JustAPI collection': ['json'] },
      });
      if (!selected?.[0]) {
        return undefined;
      }
      const file = await vscode.workspace.fs.stat(selected[0]);
      if (file.size > PROTOCOL_LIMITS.importMessageBytes) {
        throw new CommandOperationError(
          'INVALID_IMPORT',
          'The selected collection file exceeds the 10 MiB import limit.'
        );
      }
      const bytes = await vscode.workspace.fs.readFile(selected[0]);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    },
    saveCollectionFile: async (suggestedName, contents) => {
      const fileName = `${safeFileName(suggestedName)}.justapi.json`;
      const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      const destination = await vscode.window.showSaveDialog({
        ...(workspaceUri ? { defaultUri: vscode.Uri.joinPath(workspaceUri, fileName) } : {}),
        saveLabel: 'Export Collection',
        filters: { 'JustAPI collection': ['json'] },
      });
      if (!destination) {
        return false;
      }
      await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(contents));
      return true;
    },
  });

  const register = (
    command: string,
    execute: () => Promise<CommandResult>
  ): vscode.Disposable => vscode.commands.registerCommand(command, async () => {
    const result = await execute();
    await reportCommandResult(result);
    return result;
  });

  context.subscriptions.push(
    register(COMMANDS.CREATE_REQUEST, () => controller.createRequest()),
    register(COMMANDS.IMPORT_CURL, () => controller.importCurl()),
    register(COMMANDS.EXPORT_COLLECTION, () => controller.exportCollection()),
    register(COMMANDS.IMPORT_COLLECTION, () => controller.importCollection()),
    register(COMMANDS.OPEN_HISTORY, () => controller.openHistory()),
    register(COMMANDS.CREATE_VARIABLE, () => controller.createVariable()),
    register(COMMANDS.GENERATE_CODE, () => controller.generateCode())
  );
}

function safeFileName(name: string): string {
  const safe = name.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  return safe || 'collection';
}

async function reportCommandResult(result: CommandResult): Promise<void> {
  if (result.status === 'failed') {
    const details = result.error.details?.join('; ');
    await vscode.window.showErrorMessage(
      details ? `${result.error.message} ${details}` : result.error.message
    );
  } else if (result.status === 'cancelled') {
    await vscode.window.showInformationMessage(result.message);
  }
}
