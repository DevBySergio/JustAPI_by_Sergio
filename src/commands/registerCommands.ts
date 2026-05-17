import * as vscode from 'vscode';
import { COMMANDS, ViewId } from '../constants';
import { JustAPIWebviewProvider } from '../webview/JustAPIWebviewProvider';

const OPEN_JUSTAPI_VIEW_COMMAND = `workbench.view.extension.${ViewId.ACTIVITY_CONTAINER}`;

export function registerCommands(
  context: vscode.ExtensionContext,
  provider: JustAPIWebviewProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.CREATE_REQUEST, () => {
      vscode.commands.executeCommand(OPEN_JUSTAPI_VIEW_COMMAND);
      provider.createNewRequest();
    }),

    vscode.commands.registerCommand(COMMANDS.IMPORT_CURL, async () => {
      const clipboard = await vscode.env.clipboard.readText();
      if (clipboard.trim().toLowerCase().startsWith('curl')) {
        vscode.commands.executeCommand(OPEN_JUSTAPI_VIEW_COMMAND);
        // The provider will handle the curl import
        provider.postCurlImport(clipboard);
      } else {
        vscode.window.showInformationMessage('Clipboard does not contain a cURL command');
      }
    }),

    vscode.commands.registerCommand(COMMANDS.EXPORT_COLLECTION, () => {
      vscode.commands.executeCommand(OPEN_JUSTAPI_VIEW_COMMAND);
    }),

    vscode.commands.registerCommand(COMMANDS.OPEN_HISTORY, () => {
      vscode.commands.executeCommand(OPEN_JUSTAPI_VIEW_COMMAND);
    }),

    vscode.commands.registerCommand(COMMANDS.CREATE_VARIABLE, () => {
      vscode.commands.executeCommand(OPEN_JUSTAPI_VIEW_COMMAND);
    })
  );
}
