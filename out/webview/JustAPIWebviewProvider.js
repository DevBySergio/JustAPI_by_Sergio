"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.JustAPIWebviewProvider = void 0;
const vscode = __importStar(require("vscode"));
const constants_1 = require("../constants");
const HttpClient_1 = require("../engine/http/HttpClient");
const CurlParser_1 = require("../engine/http/CurlParser");
const VariableEngine_1 = require("../engine/variables/VariableEngine");
const CollectionManager_1 = require("../engine/collection/CollectionManager");
const JsonFileStore_1 = require("../storage/JsonFileStore");
const CodeGenerator_1 = require("../commands/CodeGenerator");
const VariableSetManager_1 = require("../engine/variables/VariableSetManager");
class JustAPIWebviewProvider {
    extensionUri;
    static viewType = constants_1.ViewId.SIDEBAR;
    view;
    httpClient = new HttpClient_1.HttpClient();
    curlParser = new CurlParser_1.CurlParser();
    variableEngine = new VariableEngine_1.VariableEngine();
    collectionManager;
    store;
    historyStore;
    globalVarsStore;
    settingsStore;
    variableSetManager;
    constructor(extensionUri, context, workspaceStore) {
        this.extensionUri = extensionUri;
        this.store = workspaceStore || JsonFileStore_1.JsonFileStore.fromContext(context);
        this.historyStore = workspaceStore || new JsonFileStore_1.JsonFileStore(context.globalStorageUri.fsPath);
        this.globalVarsStore = new JsonFileStore_1.JsonFileStore(context.globalStorageUri.fsPath);
        this.settingsStore = new JsonFileStore_1.JsonFileStore(context.globalStorageUri.fsPath);
        this.collectionManager = new CollectionManager_1.CollectionManager(this.store);
        this.variableSetManager = new VariableSetManager_1.VariableSetManager(this.store);
    }
    async resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        console.log('JustAPI: resolveWebviewView called');
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
            ],
        };
        webviewView.webview.html = this.getHtmlContent(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });
        webviewView.onDidChangeVisibility(() => {
            console.log('JustAPI: visibility changed, visible =', webviewView.visible);
        });
        await this.loadCollections();
        await this.variableSetManager.load();
        this.collectionManager.setOnDidChange(() => {
            this.postMessage({ type: 'collections', collections: this.collectionManager.getCollections() });
        });
        this.variableSetManager.setOnDidChange(() => {
            this.postMessage({ type: 'variableSets', sets: this.variableSetManager.getAll() });
        });
    }
    async loadCollections() {
        await this.collectionManager.load();
    }
    async handleMessage(message) {
        try {
            switch (message.type) {
                case 'webviewReady':
                    await this.sendInitialState();
                    break;
                case 'executeRequest':
                    await this.executeRequest(message.request, message.collectionId);
                    break;
                case 'cancelRequest':
                    this.httpClient.cancel();
                    this.postMessage({ type: 'requestExecuting', executing: false });
                    break;
                case 'saveRequest':
                    await this.collectionManager.saveRequest(message.request, message.collectionId, message.parentId);
                    this.postMessage({ type: 'collections', collections: this.collectionManager.getCollections() });
                    break;
                case 'deleteRequest':
                    await this.collectionManager.deleteRequest(message.requestId, message.collectionId);
                    this.postMessage({ type: 'collections', collections: this.collectionManager.getCollections() });
                    break;
                case 'getCollections':
                    this.postMessage({ type: 'collections', collections: this.collectionManager.getCollections() });
                    break;
                case 'getRequest': {
                    const req = this.collectionManager.getRequest(message.requestId);
                    if (req) {
                        this.postMessage({ type: 'requestLoaded', request: req });
                    }
                    break;
                }
                case 'createCollection':
                    await this.collectionManager.createCollection(message.name);
                    this.postMessage({ type: 'collections', collections: this.collectionManager.getCollections() });
                    break;
                case 'updateCollection':
                    await this.collectionManager.updateCollection(message.collection);
                    this.postMessage({ type: 'collections', collections: this.collectionManager.getCollections() });
                    break;
                case 'deleteCollection':
                    await this.collectionManager.deleteCollection(message.collectionId);
                    this.postMessage({ type: 'collections', collections: this.collectionManager.getCollections() });
                    break;
                case 'duplicateCollection':
                    await this.collectionManager.duplicateCollection(message.collectionId);
                    this.postMessage({ type: 'collections', collections: this.collectionManager.getCollections() });
                    break;
                case 'renameCollection': {
                    const col = this.collectionManager.getCollection(message.collectionId);
                    if (col) {
                        col.name = message.name;
                        await this.collectionManager.updateCollection(col);
                        this.postMessage({ type: 'collections', collections: this.collectionManager.getCollections() });
                    }
                    break;
                }
                case 'moveItem':
                    await this.collectionManager.moveItem(message.itemId, message.sourceCollectionId, message.targetCollectionId, message.targetParentId);
                    this.postMessage({ type: 'collections', collections: this.collectionManager.getCollections() });
                    break;
                case 'getHistory': {
                    const entries = await this.loadHistory(message.filter, message.limit);
                    this.postMessage({ type: 'history', entries });
                    break;
                }
                case 'clearHistory':
                    await this.clearHistory();
                    break;
                case 'deleteHistoryEntry':
                    await this.deleteHistoryEntry(message.entryId);
                    break;
                case 'getVariables': {
                    const vars = await this.loadGlobalVariables();
                    this.postMessage({ type: 'variables', variables: vars });
                    break;
                }
                case 'setGlobalVariables':
                    await this.saveGlobalVariables(message.variables);
                    break;
                case 'getSettings': {
                    const settings = await this.loadSettings();
                    this.postMessage({ type: 'settings', settings });
                    break;
                }
                case 'setSettings':
                    await this.saveSettings(message.settings);
                    break;
                case 'search':
                    await this.handleSearch(message.query);
                    break;
                case 'importCurl': {
                    const request = this.curlParser.parse(message.curlString);
                    this.postMessage({ type: 'curlImportResult', request });
                    break;
                }
                case 'exportCollection': {
                    const collection = this.collectionManager.getCollection(message.collectionId);
                    if (collection) {
                        const exportData = {
                            collection,
                            requests: collection.items
                                .map(item => item.type === 'request' && item.requestId ? this.collectionManager.getRequest(item.requestId) : null)
                                .filter(Boolean),
                        };
                        const doc = await vscode.workspace.openTextDocument({
                            content: JSON.stringify(exportData, null, 2),
                            language: 'json',
                        });
                        await vscode.window.showTextDocument(doc);
                    }
                    break;
                }
                case 'importCollection': {
                    try {
                        const data = JSON.parse(message.json);
                        if (data.collection) {
                            await this.collectionManager.importCollection(data.collection, data.requests || []);
                            this.postMessage({ type: 'collections', collections: this.collectionManager.getCollections() });
                        }
                    }
                    catch {
                        this.postMessage({ type: 'error', message: 'Invalid collection JSON', code: 'IMPORT_ERROR' });
                    }
                    break;
                }
                case 'generateCode': {
                    const generator = new CodeGenerator_1.CodeGenerator();
                    const code = generator.generate(message.request, message.language);
                    this.postMessage({ type: 'codeGenerationResult', code, language: message.language });
                    break;
                }
                case 'previewResolution': {
                    const colId = message.collectionId;
                    const req = message.request || {};
                    const collectionVars = colId
                        ? (this.collectionManager.getCollection(colId)?.variables || [])
                        : [];
                    const linkedSetVars = colId
                        ? this.variableSetManager.getVariablesForCollection(colId)
                        : [];
                    const allGlobals = await this.loadGlobalVariables();
                    const context = {
                        requestVars: req.variables || [],
                        collectionVars,
                        setsVars: linkedSetVars,
                        globalVars: allGlobals,
                    };
                    const resolvedUrl = this.variableEngine.resolve(req.url || '', context);
                    const resolvedBody = req.body?.content ? this.variableEngine.resolve(req.body.content, context) : '';
                    const resolvedHeaders = (req.headers || [])
                        .filter((h) => h.enabled)
                        .map((h) => ({
                        key: this.variableEngine.resolve(h.key, context),
                        value: this.variableEngine.resolve(h.value, context),
                    }));
                    this.postMessage({
                        type: 'resolutionPreview',
                        resolvedUrl,
                        resolvedHeaders: JSON.stringify(resolvedHeaders, null, 2),
                        resolvedBody,
                    });
                    break;
                }
                case 'getVariableSets':
                    this.postMessage({ type: 'variableSets', sets: this.variableSetManager.getAll() });
                    break;
                case 'createVariableSet':
                    await this.variableSetManager.create(message.name);
                    this.postMessage({ type: 'variableSets', sets: this.variableSetManager.getAll() });
                    break;
                case 'updateVariableSet':
                    await this.variableSetManager.update(message.set);
                    this.postMessage({ type: 'variableSets', sets: this.variableSetManager.getAll() });
                    break;
                case 'deleteVariableSet':
                    await this.variableSetManager.delete(message.setId);
                    this.postMessage({ type: 'variableSets', sets: this.variableSetManager.getAll() });
                    break;
                case 'linkVariableSet':
                    await this.variableSetManager.linkToCollection(message.setId, message.collectionId);
                    this.postMessage({ type: 'variableSets', sets: this.variableSetManager.getAll() });
                    break;
                case 'unlinkVariableSet':
                    await this.variableSetManager.unlinkFromCollection(message.setId, message.collectionId);
                    this.postMessage({ type: 'variableSets', sets: this.variableSetManager.getAll() });
                    break;
            }
        }
        catch (err) {
            this.postMessage({
                type: 'error',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    async executeRequest(request, collectionId) {
        this.postMessage({ type: 'requestExecuting', executing: true });
        try {
            const globalVars = await this.loadGlobalVariables();
            const collectionVars = [];
            const setsVars = [];
            if (collectionId) {
                const linkedSets = this.variableSetManager.getByCollectionId(collectionId);
                for (const set of linkedSets) {
                    for (const v of set.variables) {
                        if (v.enabled) {
                            setsVars.push(v);
                        }
                    }
                }
                const collection = this.collectionManager.getCollection(collectionId);
                if (collection?.variables) {
                    for (const v of collection.variables) {
                        if (v.enabled) {
                            collectionVars.push(v);
                        }
                    }
                }
            }
            const vars = {
                requestVars: request.variables || [],
                collectionVars,
                setsVars,
                globalVars,
            };
            const resolvedRequest = JSON.parse(JSON.stringify(request));
            resolvedRequest.url = this.variableEngine.resolve(resolvedRequest.url, vars);
            for (const h of resolvedRequest.headers) {
                h.key = this.variableEngine.resolve(h.key, vars);
                h.value = this.variableEngine.resolve(h.value, vars);
            }
            for (const p of resolvedRequest.queryParams) {
                p.key = this.variableEngine.resolve(p.key, vars);
                p.value = this.variableEngine.resolve(p.value, vars);
            }
            if (resolvedRequest.body.content) {
                resolvedRequest.body.content = this.variableEngine.resolve(resolvedRequest.body.content, vars);
            }
            const response = await this.httpClient.execute(resolvedRequest);
            this.postMessage({ type: 'response', response });
            // Check for unresolved variables and notify
            const unresolvedUrl = this.variableEngine.findUnresolved(request.url, vars);
            const unresolvedBody = request.body.content ? this.variableEngine.findUnresolved(request.body.content, vars) : [];
            const unresolved = [...unresolvedUrl, ...unresolvedBody].filter((v, i, a) => a.indexOf(v) === i);
            if (unresolved.length > 0) {
                this.postMessage({
                    type: 'error',
                    message: `Unresolved variables: ${unresolved.join(', ')}`,
                });
            }
            if (response.statusCode > 0) {
                await this.saveToHistory(request, response);
            }
        }
        finally {
            this.postMessage({ type: 'requestExecuting', executing: false });
        }
    }
    async sendInitialState() {
        await this.collectionManager.load();
        await this.variableSetManager.load();
        const collections = this.collectionManager.getCollections();
        const history = await this.loadHistory();
        const variables = await this.loadGlobalVariables();
        const settings = await this.loadSettings();
        const variableSets = this.variableSetManager.getAll();
        const state = {
            collections,
            history,
            variables,
            variableSets,
            settings,
            workspaceEnabled: false,
        };
        this.postMessage({ type: 'initialState', state });
    }
    async loadHistory(filter, limit) {
        const allEntries = await this.historyStore.read('history');
        if (!allEntries)
            return [];
        let entries = allEntries;
        if (filter) {
            const lower = filter.toLowerCase();
            entries = entries.filter(e => e.url.toLowerCase().includes(lower) ||
                e.method.toLowerCase().includes(lower) ||
                e.statusCode.toString().includes(lower));
        }
        entries.sort((a, b) => b.timestamp - a.timestamp);
        if (limit && limit > 0) {
            entries = entries.slice(0, limit);
        }
        return entries;
    }
    async saveToHistory(request, response) {
        const entry = {
            id: crypto.randomUUID(),
            request,
            response,
            timestamp: Date.now(),
            duration: response.duration,
            statusCode: response.statusCode,
            url: request.url,
            method: request.method,
        };
        const entries = await this.historyStore.read('history') || [];
        entries.unshift(entry);
        const MAX_HISTORY = 200;
        if (entries.length > MAX_HISTORY) {
            entries.length = MAX_HISTORY;
        }
        await this.historyStore.write('history', entries);
        this.postMessage({ type: 'historyEntry', entry });
    }
    async clearHistory() {
        await this.historyStore.write('history', []);
        this.postMessage({ type: 'history', entries: [] });
    }
    async deleteHistoryEntry(entryId) {
        const entries = await this.historyStore.read('history') || [];
        const filtered = entries.filter(e => e.id !== entryId);
        await this.historyStore.write('history', filtered);
    }
    async loadGlobalVariables() {
        return await this.globalVarsStore.read('globalVariables') || [];
    }
    async saveGlobalVariables(variables) {
        await this.globalVarsStore.write('globalVariables', variables);
    }
    async loadSettings() {
        return await this.settingsStore.read('settings') || {};
    }
    async saveSettings(settings) {
        await this.settingsStore.write('settings', settings);
    }
    async handleSearch(query) {
        const lower = query.toLowerCase();
        const results = [];
        for (const collection of this.collectionManager.getCollections()) {
            if (collection.name.toLowerCase().includes(lower)) {
                results.push({ type: 'collection', id: collection.id, name: collection.name, matchField: 'name' });
            }
            this.searchItems(collection.items, lower, collection.id, results);
        }
        const history = await this.loadHistory();
        for (const entry of history) {
            if (entry.url.toLowerCase().includes(lower) || entry.method.toLowerCase().includes(lower)) {
                results.push({
                    type: 'request',
                    id: entry.id,
                    name: `${entry.method} ${entry.url}`,
                    url: entry.url,
                    matchField: 'url',
                });
            }
        }
        this.postMessage({ type: 'searchResults', results });
    }
    searchItems(items, query, collectionId, results) {
        for (const item of items) {
            if (item.name.toLowerCase().includes(query)) {
                results.push({
                    type: item.type,
                    id: item.id,
                    name: item.name,
                    collectionId,
                    matchField: 'name',
                });
            }
            if (item.type === 'folder' && item.items) {
                this.searchItems(item.items, query, collectionId, results);
            }
            if (item.type === 'request' && item.requestId) {
                const req = this.collectionManager.getRequest(item.requestId);
                if (req?.url.toLowerCase().includes(query)) {
                    results.push({
                        type: 'request',
                        id: req.id,
                        name: `${req.method} ${req.url}`,
                        collectionId,
                        url: req.url,
                        matchField: 'url',
                    });
                }
            }
        }
    }
    createNewRequest() {
        this.postMessage({ type: 'createNewRequest' });
    }
    postCurlImport(curlString) {
        try {
            const request = this.curlParser.parse(curlString);
            this.postMessage({ type: 'curlImportResult', request });
        }
        catch (err) {
            this.postMessage({
                type: 'error',
                message: err instanceof Error ? err.message : 'Failed to parse cURL',
            });
        }
    }
    dispose() {
        this.httpClient.cancel();
    }
    postMessage(message) {
        this.view?.webview.postMessage(message);
    }
    getHtmlContent(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'bundle.js'));
        const nonce = this.getNonce();
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

    /* Hover states */
    button:hover:not(:disabled) { opacity: 0.85; }
    button:active:not(:disabled) { opacity: 0.7; }
    .tab-btn:hover { opacity: 0.9; }
    .search-result-item:hover { background: var(--vscode-list-hoverBackground); }

    /* Focus indicators */
    input:focus, select:focus, textarea:focus, button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder) !important;
      outline-offset: -1px !important;
    }

    /* Transitions */
    button, input, select, textarea {
      transition: opacity 0.15s, background 0.15s, border-color 0.15s;
    }

    /* Spinner */
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

    /* Toast slide-in */
    @keyframes slideDown {
      from { transform: translateY(-100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    /* Scrollbar styling */
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
    getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 64; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
exports.JustAPIWebviewProvider = JustAPIWebviewProvider;
//# sourceMappingURL=JustAPIWebviewProvider.js.map