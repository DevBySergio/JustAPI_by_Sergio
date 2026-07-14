import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { JustRequest } from '../models/Request';
import { JustResponse } from '../models/Response';
import { Collection } from '../models/Collection';
import { Variable } from '../models/Variable';
import { HistoryEntry } from '../models/HistoryEntry';
import {
  ExtensionMessage,
  InitialState,
  ProtocolErrorCode,
  SearchResult,
  WebviewMessage,
} from '../models/MessageProtocol';
import { ViewId } from '../constants';
import { HttpClient } from '../engine/http/HttpClient';
import { CurlParser } from '../engine/http/CurlParser';
import { VariableEngine } from '../engine/variables/VariableEngine';
import { CollectionManager } from '../engine/collection/CollectionManager';
import { JsonFileStore } from '../storage/JsonFileStore';
import { CodeGenerator } from '../commands/CodeGenerator';
import { VariableSetManager } from '../engine/variables/VariableSetManager';
import {
  isProtocolIdentifier,
  protocolFailure,
  validateCollectionImportDocument,
  validateExtensionMessage,
  validateWebviewMessage,
} from '../protocol/MessageValidator';
import { ExecutionRegistry, OperationRegistry } from '../protocol/OperationRegistry';

export class JustAPIWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = ViewId.SIDEBAR;

  private view?: vscode.WebviewView;
  private curlParser = new CurlParser();
  private variableEngine = new VariableEngine();
  private collectionManager: CollectionManager;
  private store: JsonFileStore;
  private historyStore: JsonFileStore;
  private globalVarsStore: JsonFileStore;
  private settingsStore: JsonFileStore;
  private variableSetManager: VariableSetManager;
  private readonly operations = new OperationRegistry();
  private readonly executions = new ExecutionRegistry();

  constructor(
    private readonly extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    workspaceStore?: JsonFileStore
  ) {
    this.store = workspaceStore || JsonFileStore.fromContext(context);
    this.historyStore = workspaceStore || new JsonFileStore(context.globalStorageUri.fsPath);
    this.globalVarsStore = new JsonFileStore(context.globalStorageUri.fsPath);
    this.settingsStore = new JsonFileStore(context.globalStorageUri.fsPath);
    this.collectionManager = new CollectionManager(this.store);
    this.variableSetManager = new VariableSetManager(this.store);
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.view = webviewView;
    console.log('JustAPI: resolveWebviewView called');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      await this.handleMessage(message);
    });

    webviewView.onDidChangeVisibility(() => {
      console.log('JustAPI: visibility changed, visible =', webviewView.visible);
    });

    await this.loadCollections();
    await this.variableSetManager.load();
  }

  private async loadCollections(): Promise<void> {
    await this.collectionManager.load();
  }

  private async handleMessage(rawMessage: unknown): Promise<void> {
    const validation = validateWebviewMessage(rawMessage);
    if (!validation.ok) {
      const operationId = this.extractOperationId(rawMessage);
      this.postError(operationId, validation.code);
      return;
    }

    const message = validation.value;
    if (!this.operations.claim(message.operationId)) {
      this.postError(message.operationId, 'DUPLICATE_OPERATION', this.executionIdOf(message));
      return;
    }

    try {
      switch (message.type) {
        case 'webviewReady':
          await this.sendInitialState(message.operationId);
          break;

        case 'executeRequest':
          if (!await this.executeRequest(message)) {
            return;
          }
          break;

        case 'cancelRequest': {
          const entry = this.executions.cancel(message.executionId);
          if (!entry) {
            this.postError(message.operationId, 'EXECUTION_NOT_FOUND', message.executionId);
            return;
          }
          this.postMessage({
            type: 'requestExecuting',
            operationId: entry.operationId,
            executionId: entry.executionId,
            executing: false,
          });
          break;
        }

        case 'saveRequest':
          await this.collectionManager.saveRequest(message.request, message.collectionId, message.parentId);
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;

        case 'deleteRequest':
          await this.collectionManager.deleteRequest(message.requestId, message.collectionId);
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;

        case 'getCollections':
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;

        case 'getRequest': {
          const request = this.collectionManager.getRequest(message.requestId);
          if (!request) {
            this.postError(message.operationId, 'OPERATION_FAILED');
            return;
          }
          this.postMessage({ type: 'requestLoaded', operationId: message.operationId, request });
          break;
        }

        case 'createCollection':
          await this.collectionManager.createCollection(message.name);
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;

        case 'updateCollection':
          await this.collectionManager.updateCollection(message.collection);
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;

        case 'deleteCollection':
          await this.collectionManager.deleteCollection(message.collectionId);
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;

        case 'duplicateCollection':
          await this.collectionManager.duplicateCollection(message.collectionId);
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;

        case 'renameCollection': {
          const collection = this.collectionManager.getCollection(message.collectionId);
          if (!collection) {
            this.postError(message.operationId, 'OPERATION_FAILED');
            return;
          }
          collection.name = message.name;
          await this.collectionManager.updateCollection(collection);
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;
        }

        case 'moveItem':
          await this.collectionManager.moveItem(
            message.itemId,
            message.sourceCollectionId,
            message.targetCollectionId,
            message.targetParentId
          );
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;

        case 'getHistory': {
          const entries = await this.loadHistory(message.filter, message.limit);
          this.postMessage({ type: 'history', operationId: message.operationId, entries });
          break;
        }

        case 'clearHistory':
          await this.clearHistory(message.operationId);
          break;

        case 'deleteHistoryEntry':
          await this.deleteHistoryEntry(message.entryId);
          break;

        case 'getVariables': {
          const variables = await this.loadGlobalVariables();
          this.postMessage({ type: 'variables', operationId: message.operationId, variables });
          break;
        }

        case 'setGlobalVariables':
          await this.saveGlobalVariables(message.variables);
          break;

        case 'getSettings': {
          const settings = await this.loadSettings();
          this.postMessage({ type: 'settings', operationId: message.operationId, settings });
          break;
        }

        case 'setSettings':
          await this.saveSettings(message.settings);
          break;

        case 'search':
          await this.handleSearch(message.query, message.operationId);
          break;

        case 'importCurl': {
          const request = this.curlParser.parse(message.curlString);
          this.postMessage({ type: 'curlImportResult', operationId: message.operationId, request });
          break;
        }

        case 'exportCollection': {
          const collection = this.collectionManager.getCollection(message.collectionId);
          if (!collection) {
            this.postError(message.operationId, 'OPERATION_FAILED');
            return;
          }
          const exportData = {
            collection,
            requests: collection.items
              .map(item => item.type === 'request' && item.requestId
                ? this.collectionManager.getRequest(item.requestId)
                : null)
              .filter((request): request is JustRequest => request !== null && request !== undefined),
          };
          const document = await vscode.workspace.openTextDocument({
            content: JSON.stringify(exportData, null, 2),
            language: 'json',
          });
          await vscode.window.showTextDocument(document);
          break;
        }

        case 'importCollection': {
          const importValidation = validateCollectionImportDocument(message.json);
          if (!importValidation.ok) {
            this.postError(message.operationId, importValidation.code === 'MESSAGE_TOO_LARGE'
              ? 'MESSAGE_TOO_LARGE'
              : 'IMPORT_ERROR');
            return;
          }
          await this.collectionManager.importCollection(
            importValidation.value.collection,
            importValidation.value.requests
          );
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;
        }

        case 'generateCode': {
          const generator = new CodeGenerator();
          const code = generator.generate(message.request, message.language);
          this.postMessage({
            type: 'codeGenerationResult',
            operationId: message.operationId,
            code,
            language: message.language,
          });
          break;
        }

        case 'previewResolution': {
          const collectionId = message.collectionId;
          const request = message.request;
          const collectionVars: Variable[] = collectionId
            ? (this.collectionManager.getCollection(collectionId)?.variables || [])
            : [];
          const linkedSetVars: Variable[] = collectionId
            ? this.variableSetManager.getVariablesForCollection(collectionId)
            : [];
          const allGlobals = await this.loadGlobalVariables();
          const context = {
            requestVars: request?.variables || [],
            collectionVars,
            setsVars: linkedSetVars,
            globalVars: allGlobals,
          };
          const resolvedUrl = this.variableEngine.resolve(request?.url || '', context);
          const resolvedBody = request?.body.content
            ? this.variableEngine.resolve(request.body.content, context)
            : '';
          const resolvedHeaders = (request?.headers || [])
            .filter(header => header.enabled)
            .map(header => ({
              key: this.variableEngine.resolve(header.key, context),
              value: this.variableEngine.resolve(header.value, context),
            }));
          this.postMessage({
            type: 'resolutionPreview',
            operationId: message.operationId,
            resolvedUrl,
            resolvedHeaders: JSON.stringify(resolvedHeaders, null, 2),
            resolvedBody,
          });
          break;
        }

        case 'getVariableSets':
          this.postMessage({
            type: 'variableSets',
            operationId: message.operationId,
            sets: this.variableSetManager.getAll(),
          });
          break;

        case 'createVariableSet':
          await this.variableSetManager.create(message.name);
          this.postMessage({
            type: 'variableSets',
            operationId: message.operationId,
            sets: this.variableSetManager.getAll(),
          });
          break;

        case 'updateVariableSet':
          await this.variableSetManager.update(message.set);
          this.postMessage({
            type: 'variableSets',
            operationId: message.operationId,
            sets: this.variableSetManager.getAll(),
          });
          break;

        case 'deleteVariableSet':
          await this.variableSetManager.delete(message.setId);
          this.postMessage({
            type: 'variableSets',
            operationId: message.operationId,
            sets: this.variableSetManager.getAll(),
          });
          break;

        case 'linkVariableSet':
          await this.variableSetManager.linkToCollection(message.setId, message.collectionId);
          this.postMessage({
            type: 'variableSets',
            operationId: message.operationId,
            sets: this.variableSetManager.getAll(),
          });
          break;

        case 'unlinkVariableSet':
          await this.variableSetManager.unlinkFromCollection(message.setId, message.collectionId);
          this.postMessage({
            type: 'variableSets',
            operationId: message.operationId,
            sets: this.variableSetManager.getAll(),
          });
          break;
      }
      this.acknowledge(message);
    } catch {
      this.postError(message.operationId, 'OPERATION_FAILED', this.executionIdOf(message));
    }
  }

  private async executeRequest(
    message: Extract<WebviewMessage, { type: 'executeRequest' }>
  ): Promise<boolean> {
    const client = new HttpClient();
    const execution = this.executions.register(message.operationId, message.executionId, client);
    if (!execution) {
      this.postError(message.operationId, 'DUPLICATE_EXECUTION', message.executionId);
      return false;
    }

    this.postMessage({
      type: 'requestExecuting',
      operationId: message.operationId,
      executionId: message.executionId,
      executing: true,
    });

    try {
      const globalVars = await this.loadGlobalVariables();
      const collectionVars: Variable[] = [];
      const setsVars: Variable[] = [];

      if (message.collectionId) {
        const linkedSets = this.variableSetManager.getByCollectionId(message.collectionId);
        for (const set of linkedSets) {
          for (const v of set.variables) {
            if (v.enabled) {
              setsVars.push(v);
            }
          }
        }
        const collection = this.collectionManager.getCollection(message.collectionId);
        if (collection?.variables) {
          for (const v of collection.variables) {
            if (v.enabled) {
              collectionVars.push(v);
            }
          }
        }
      }

      const vars = {
        requestVars: message.request.variables || [],
        collectionVars,
        setsVars,
        globalVars,
      };

      const resolvedRequest = JSON.parse(JSON.stringify(message.request)) as JustRequest;

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

      const response = await client.execute(resolvedRequest);
      if (execution.cancelled) {
        return true;
      }

      this.postMessage({
        type: 'response',
        operationId: message.operationId,
        executionId: message.executionId,
        response,
      });

      // Check for unresolved variables and notify
      const unresolvedUrl = this.variableEngine.findUnresolved(message.request.url, vars);
      const unresolvedBody = message.request.body.content
        ? this.variableEngine.findUnresolved(message.request.body.content, vars)
        : [];
      const unresolved = [...unresolvedUrl, ...unresolvedBody].filter((v, i, a) => a.indexOf(v) === i);
      if (unresolved.length > 0) {
        this.postMessage({
          type: 'error',
          operationId: message.operationId,
          executionId: message.executionId,
          message: 'The request contains unresolved variables.',
          code: 'OPERATION_FAILED',
        });
      }

      if (response.statusCode > 0) {
        await this.saveToHistory(
          message.request,
          response,
          message.operationId,
          message.executionId
        );
      }
      return true;
    } catch {
      if (!execution.cancelled) {
        this.postError(message.operationId, 'OPERATION_FAILED', message.executionId);
      }
      return false;
    } finally {
      this.executions.complete(message.executionId);
      this.postMessage({
        type: 'requestExecuting',
        operationId: message.operationId,
        executionId: message.executionId,
        executing: false,
      });
    }
  }

  private async sendInitialState(operationId: string): Promise<void> {
    await this.collectionManager.load();
    await this.variableSetManager.load();
    const collections = this.collectionManager.getCollections();
    const history = await this.loadHistory();
    const variables = await this.loadGlobalVariables();
    const settings = await this.loadSettings();
    const variableSets = this.variableSetManager.getAll();

    const state: InitialState = {
      collections,
      history,
      variables,
      variableSets,
      settings,
    };

    this.postMessage({ type: 'initialState', operationId, state });
  }

  private async loadHistory(filter?: string, limit?: number): Promise<HistoryEntry[]> {
    const allEntries = await this.historyStore.read<HistoryEntry[]>('history');
    if (!allEntries) { return []; }

    let entries = allEntries;
    if (filter) {
      const lower = filter.toLowerCase();
      entries = entries.filter(e =>
        e.url.toLowerCase().includes(lower) ||
        e.method.toLowerCase().includes(lower) ||
        e.statusCode.toString().includes(lower)
      );
    }

    entries.sort((a, b) => b.timestamp - a.timestamp);

    if (limit && limit > 0) {
      entries = entries.slice(0, limit);
    }

    return entries;
  }

  private async saveToHistory(
    request: JustRequest,
    response: JustResponse,
    operationId: string,
    executionId: string
  ): Promise<void> {
    const entry: HistoryEntry = {
      id: randomUUID(),
      request,
      response,
      timestamp: Date.now(),
      duration: response.duration,
      statusCode: response.statusCode,
      url: request.url,
      method: request.method,
    };

    const entries = await this.historyStore.read<HistoryEntry[]>('history') || [];
    entries.unshift(entry);

    const MAX_HISTORY = 200;
    if (entries.length > MAX_HISTORY) {
      entries.length = MAX_HISTORY;
    }

    await this.historyStore.write('history', entries);
    this.postMessage({ type: 'historyEntry', operationId, executionId, entry });
  }

  private async clearHistory(operationId: string): Promise<void> {
    await this.historyStore.write('history', []);
    this.postMessage({ type: 'history', operationId, entries: [] });
  }

  private async deleteHistoryEntry(entryId: string): Promise<void> {
    const entries = await this.historyStore.read<HistoryEntry[]>('history') || [];
    const filtered = entries.filter(e => e.id !== entryId);
    await this.historyStore.write('history', filtered);
  }

  private async loadGlobalVariables(): Promise<Variable[]> {
    return await this.globalVarsStore.read<Variable[]>('globalVariables') || [];
  }

  private async saveGlobalVariables(variables: Variable[]): Promise<void> {
    await this.globalVarsStore.write('globalVariables', variables);
  }

  private async loadSettings(): Promise<Record<string, unknown>> {
    return await this.settingsStore.read<Record<string, unknown>>('settings') || {};
  }

  private async saveSettings(settings: Record<string, unknown>): Promise<void> {
    await this.settingsStore.write('settings', settings);
  }

  private async handleSearch(query: string, operationId: string): Promise<void> {
    const lower = query.toLowerCase();
    const results: SearchResult[] = [];

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

    this.postMessage({ type: 'searchResults', operationId, results });
  }

  private searchItems(
    items: Collection['items'],
    query: string,
    collectionId: string,
    results: SearchResult[]
  ): void {
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

  createNewRequest(): void {
    this.postMessage({ type: 'createNewRequest', operationId: this.createOperationId() });
  }

  postCurlImport(curlString: string): void {
    const operationId = this.createOperationId();
    try {
      const request = this.curlParser.parse(curlString);
      this.postMessage({ type: 'curlImportResult', operationId, request });
    } catch {
      this.postError(operationId, 'OPERATION_FAILED');
    }
  }

  dispose(): void {
    this.executions.cancelAll();
  }

  private postMessage(message: ExtensionMessage): void {
    const validation = validateExtensionMessage(message);
    if (validation.ok) {
      this.view?.webview.postMessage(validation.value);
      return;
    }

    const outboundFailure = protocolFailure('OUTBOUND_MESSAGE_INVALID');
    const operationId = isProtocolIdentifier(message.operationId)
      ? message.operationId
      : this.createOperationId();
    const executionId = 'executionId' in message && isProtocolIdentifier(message.executionId)
      ? message.executionId
      : undefined;
    this.view?.webview.postMessage({
      type: 'error',
      operationId,
      ...(executionId ? { executionId } : {}),
      code: outboundFailure.code,
      message: outboundFailure.message,
    } satisfies ExtensionMessage);
  }

  private postError(operationId: string, code: ProtocolErrorCode, executionId?: string): void {
    const error = protocolFailure(code);
    this.postMessage({
      type: 'error',
      operationId,
      ...(executionId ? { executionId } : {}),
      code: error.code,
      message: error.message,
    });
  }

  private acknowledge(message: WebviewMessage): void {
    const executionId = this.executionIdOf(message);
    this.postMessage({
      type: 'acknowledgement',
      operationId: message.operationId,
      action: message.type,
      status: 'completed',
      ...(executionId ? { executionId } : {}),
    });
  }

  private executionIdOf(message: WebviewMessage): string | undefined {
    return 'executionId' in message ? message.executionId : undefined;
  }

  private extractOperationId(message: unknown): string {
    if (message !== null && typeof message === 'object' && 'operationId' in message) {
      const operationId = (message as { operationId?: unknown }).operationId;
      if (isProtocolIdentifier(operationId)) {
        return operationId;
      }
    }
    return this.createOperationId();
  }

  private createOperationId(): string {
    return `operation-${randomUUID()}`;
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'bundle.js')
    );

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

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 64; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
