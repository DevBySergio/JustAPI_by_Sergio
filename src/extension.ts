import * as vscode from 'vscode';
import { JustAPIWebviewProvider } from './webview/JustAPIWebviewProvider';
import { registerCommands } from './commands/registerCommands';

let provider: JustAPIWebviewProvider;

export function activate(context: vscode.ExtensionContext): void {
  console.log('JustAPI extension activating...');
  provider = new JustAPIWebviewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      JustAPIWebviewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  registerCommands(context, provider);
}

export async function deactivate(): Promise<void> {
  await provider?.dispose();
}
