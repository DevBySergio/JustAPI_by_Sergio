import * as vscode from 'vscode';

export function createNonce(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 64; index += 1) {
    nonce += alphabet.charAt(Math.floor(random() * alphabet.length));
  }
  return nonce;
}

export function renderWebviewDocument(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string = createNonce()
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'bundle.js')
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-sideBar-background);
      overflow-x: hidden;
    }
    #root { height: 100vh; }
    .vscode-dark { color-scheme: dark; }
    .vscode-light { color-scheme: light; }
    button:hover:not(:disabled) { opacity: 0.85; }
    button:active:not(:disabled) { opacity: 0.7; }
    .tab-btn:hover { opacity: 0.9; }
    .search-result-item:hover { background: var(--vscode-list-hoverBackground); }
    input:focus, select:focus, textarea:focus, button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder) !important;
      outline-offset: -1px !important;
    }
    button, input, select, textarea {
      transition: opacity 0.15s, background 0.15s, border-color 0.15s;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--vscode-button-foreground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 4px;
    }
    @keyframes slideDown {
      from { transform: translateY(-100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
    .loading { padding: 20px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .error { padding: 16px; background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-errorForeground); margin: 8px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div id="root"><div class="loading">JustAPI loading...</div></div>
  <script nonce="${nonce}">
    window.addEventListener('error', function(e) {
      var root = document.getElementById('root');
      if (root) {
        root.innerHTML = '<div class="error">Runtime Error: ' + (e.message || 'Unknown error') + '</div>';
      }
    });
    window.addEventListener('unhandledrejection', function(e) {
      var root = document.getElementById('root');
      if (root) {
        root.innerHTML = '<div class="error">Promise Error: ' + (e.reason?.message || 'Unknown') + '</div>';
      }
    });
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
