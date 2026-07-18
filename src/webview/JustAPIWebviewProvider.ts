import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { JustRequest, PersistedJustRequest } from '../models/Request';
import { JustResponse } from '../models/Response';
import { Collection } from '../models/Collection';
import { Variable } from '../models/Variable';
import { HistoryEntry } from '../models/HistoryEntry';
import {
  ExtensionMessage,
  InitialState,
  ProtocolErrorCode,
  SearchResult,
  StartupAction,
  WebviewMessage,
} from '../models/MessageProtocol';
import { ViewId } from '../constants';
import { HttpClient } from '../engine/http/HttpClient';
import { CurlParseError, CurlParser } from '../engine/http/CurlParser';
import { ResolutionContext, VariableEngine } from '../engine/variables/VariableEngine';
import { CollectionManager } from '../engine/collection/CollectionManager';
import { JsonFileStore } from '../storage/JsonFileStore';
import { CodeGenerator } from '../commands/CodeGenerator';
import { normalizeEffectiveRequest } from '../engine/http/EffectiveRequest';
import { VariableSetManager } from '../engine/variables/VariableSetManager';
import { createHistorySummary, normalizeHistoryData } from '../storage/HistorySummary';
import type { StorageFailure } from '../storage/JsonFileStore';
import {
  isProtocolIdentifier,
  protocolFailure,
  validateCollectionImportDocument,
  validateExtensionMessage,
  validateWebviewMessage,
} from '../protocol/MessageValidator';
import { ExecutionRegistry, OperationRegistry } from '../protocol/OperationRegistry';
import { AuthService, AuthServiceError } from '../engine/auth/AuthService';
import { COLLECTION_TRANSFER_SCHEMA_VERSION } from '../models/CollectionTransfer';
import { CollectionIntegrityError } from '../engine/collection/CollectionGraph';
import {
  CommandOperationError,
  CommandStartupAction,
} from '../commands/CommandController';
import { StartupActionQueue } from '../commands/StartupActionQueue';

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
  private stores: JsonFileStore[];
  private variableSetManager: VariableSetManager;
  private readonly authService: AuthService;
  private readonly operations = new OperationRegistry();
  private readonly executions = new ExecutionRegistry();
  private readonly startupActions: StartupActionQueue<StartupAction>;
  private readonly viewDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    workspaceStore?: JsonFileStore
  ) {
    const storageOptions = {
      onFailure: (failure: StorageFailure) => this.reportStorageFailure(failure),
      dataTransforms: { history: normalizeHistoryData },
    };
    const globalStore = JsonFileStore.fromContext(context, storageOptions);
    this.store = workspaceStore || globalStore;
    this.historyStore = workspaceStore
      ? new JsonFileStore(workspaceStore.getBasePath(), storageOptions)
      : globalStore;
    this.globalVarsStore = globalStore;
    this.settingsStore = globalStore;
    this.stores = Array.from(new Set([
      this.store,
      this.historyStore,
      this.globalVarsStore,
      this.settingsStore,
    ]));
    this.authService = new AuthService(context.secrets);
    this.collectionManager = new CollectionManager(this.store, {
      duplicateRequest: (request, newRequestId) =>
        this.authService.duplicateRequest(request, newRequestId),
      afterRemove: (removed, remaining) =>
        this.authService.cleanupRemovedRequests(removed, remaining),
    });
    this.variableSetManager = new VariableSetManager(this.store);
    this.startupActions = new StartupActionQueue(async (operationId, action) => (
      await this.postStartupAction(operationId, action)
    ));
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.disposeViewListeners();
    this.view = webviewView;
    this.startupActions.resetForNewTarget();
    console.log('JustAPI: resolveWebviewView called');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
        await this.handleMessage(message);
      }),
      webviewView.onDidChangeVisibility(() => {
        console.log('JustAPI: visibility changed, visible =', webviewView.visible);
      })
    );

    await this.loadCollections();
    await this.variableSetManager.load();
  }

  private async loadCollections(): Promise<void> {
    await this.collectionManager.load();
    await this.authService.migrateLegacyRequests(
      this.collectionManager.getRequests(),
      requests => this.collectionManager.replaceRequests(requests)
    );
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
          this.startupActions.setReady(true);
          break;

        case 'startupActionHandled':
          if (!this.startupActions.complete(message.operationId)) {
            this.postError(message.operationId, 'OPERATION_FAILED');
            return;
          }
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

        case 'saveRequest': {
          const existing = this.collectionManager.getRequest(message.request.id);
          const staged = await this.authService.stageRecognizedLegacyAuth(message.request, existing);
          const persisted = this.authService.prepareForSave(staged.request, existing);
          try {
            await this.collectionManager.saveRequest(persisted, message.collectionId, message.parentId);
            await this.authService.commitSave(message.request.id, this.collectionManager.getRequests());
          } catch (error) {
            await this.authService.rollbackSave(message.request.id);
            throw error;
          }
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          const saved = this.collectionManager.getRequest(message.request.id);
          if (saved) {
            this.postMessage({
              type: 'requestLoaded',
              operationId: message.operationId,
              request: this.authService.toPublicRequest(saved),
            });
          }
          break;
        }

        case 'deleteRequest':
          await this.collectionManager.deleteRequest(message.requestId, message.collectionId);
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;

        case 'configureAuth': {
          const existing = this.collectionManager.getRequest(message.requestId);
          const auth = await this.authService.configure(message.requestId, message.auth, existing);
          this.postMessage({
            type: 'requestAuthUpdated',
            operationId: message.operationId,
            requestId: message.requestId,
            auth,
          });
          break;
        }

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
          this.postMessage({
            type: 'requestLoaded',
            operationId: message.operationId,
            request: this.authService.toPublicRequest(request),
          });
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
            message.targetParentId,
            message.targetIndex
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
          const parsed = this.curlParser.parseWithWarnings(message.curlString);
          const { request } = await this.authService.stageRecognizedLegacyAuth(parsed.request);
          this.postMessage({
            type: 'curlImportResult',
            operationId: message.operationId,
            request,
            warnings: parsed.warnings,
          });
          break;
        }

        case 'cancelCurlImport': {
          await this.authService.rollbackSave(message.requestId);
          break;
        }

        case 'exportCollection': {
          const collection = this.collectionManager.getCollection(message.collectionId);
          if (!collection) {
            this.postError(message.operationId, 'OPERATION_FAILED');
            return;
          }
          const persistedRequests = this.collectionManager.getRequestsForCollection(collection.id);
          const includeCredentials = message.includeCredentials === true
            && await this.confirmCredentialDisclosure(`collection “${collection.name}” export`);
          const requests: JustRequest[] = [];
          for (const persisted of persistedRequests) {
            const request = this.authService.toPublicRequest(persisted);
            requests.push(includeCredentials
              ? await this.authService.resolveForTransport(request, persisted)
              : this.authService.redactForDerivative(request));
          }
          const exportData = {
            schemaVersion: COLLECTION_TRANSFER_SCHEMA_VERSION,
            collection,
            requests,
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
              : 'IMPORT_ERROR', undefined, importValidation.details);
            return;
          }
          const importedRequests = importValidation.value.requests
            .map(request => this.authService.prepareForImport(request));
          let imported = false;
          await this.authService.migrateLegacyRequests(importedRequests, async securedRequests => {
            await this.collectionManager.importCollection(
              importValidation.value.collection,
              securedRequests
            );
            imported = true;
          });
          if (!imported) {
            await this.collectionManager.importCollection(
              importValidation.value.collection,
              importedRequests
            );
          }
          this.postMessage({
            type: 'collections',
            operationId: message.operationId,
            collections: this.collectionManager.getCollections(),
          });
          break;
        }

        case 'generateCode': {
          const generator = new CodeGenerator();
          const persisted = this.collectionManager.getRequest(message.request.id);
          const context = await this.buildResolutionContext(message.request, message.collectionId);
          const preflight = this.variableEngine.resolveRequest(message.request, context);
          if (!preflight.ok) {
            this.postError(message.operationId, 'VARIABLE_RESOLUTION_FAILED');
            return;
          }
          const includeCredentials = message.includeCredentials === true
            && await this.confirmCredentialDisclosure(`${message.language} code sample`);
          const request = includeCredentials
            ? await this.authService.resolveForTransport(
                preflight.request,
                persisted,
                message.request.auth
              )
            : this.authService.redactForDerivative(preflight.request);
          const code = generator.generate(request, message.language, {
            credentialRepresentation: includeCredentials ? 'resolved' : 'placeholder',
          });
          this.postMessage({
            type: 'codeGenerationResult',
            operationId: message.operationId,
            code,
            language: message.language,
          });
          break;
        }

        case 'previewResolution': {
          const source = message.request;
          const context = await this.buildResolutionContext(source, message.collectionId);
          const preflight = source
            ? this.variableEngine.resolveRequest(
                this.authService.redactForDerivative(source),
                context
              )
            : null;
          const resolvedRequest = preflight?.request;
          let effectiveRequest: ReturnType<typeof normalizeEffectiveRequest> | undefined;
          if (resolvedRequest) {
            try {
              effectiveRequest = normalizeEffectiveRequest(resolvedRequest, {
                credentialRepresentation: 'placeholder',
              });
            } catch {
              // Keep unresolved editor values visible while validation reports the blocking issue.
            }
          }
          const resolvedHeaders = effectiveRequest?.headers
            .map(({ name: key, value }) => ({ key, value }))
            ?? (resolvedRequest?.headers || [])
              .filter(header => header.enabled)
              .map(({ key, value }) => ({ key, value }));
          const resolvedQueryParams = (resolvedRequest?.queryParams || [])
            .filter(param => param.enabled)
            .map(({ key, value }) => ({ key, value }));
          const resolvedBody = effectiveRequest
            && (effectiveRequest.body.type === 'form-data'
              || effectiveRequest.body.type === 'x-www-form-urlencoded')
            ? JSON.stringify(
                effectiveRequest.body.fields.map(({ name: key, value }) => ({ key, value })),
                null,
                2
              )
            : effectiveRequest?.body.content ?? resolvedRequest?.body.content ?? '';
          this.postMessage({
            type: 'resolutionPreview',
            operationId: message.operationId,
            resolvedUrl: effectiveRequest?.url ?? resolvedRequest?.url ?? '',
            resolvedHeaders: JSON.stringify(resolvedHeaders, null, 2),
            resolvedQueryParams: JSON.stringify(resolvedQueryParams, null, 2),
            resolvedBody,
            diagnostics: preflight?.diagnostics || [],
            canExecute: preflight?.ok ?? true,
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
    } catch (error) {
      if (error instanceof CurlParseError) {
        this.postError(
          message.operationId,
          'CURL_PARSE_ERROR',
          this.executionIdOf(message),
          [`${error.code}${error.tokenIndex === undefined ? '' : ` at token ${error.tokenIndex}`}`]
        );
        return;
      }
      if (error instanceof CollectionIntegrityError) {
        this.postError(
          message.operationId,
          message.type === 'importCollection' ? 'IMPORT_ERROR' : 'OPERATION_FAILED',
          this.executionIdOf(message),
          error.issues.map(issue => issue.entityId
            ? `${issue.code}: ${issue.entityId}`
            : issue.code)
        );
        return;
      }
      const code = error instanceof AuthServiceError && error.code !== 'AUTH_INVALID'
        ? error.code
        : 'OPERATION_FAILED';
      this.postError(message.operationId, code, this.executionIdOf(message));
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
      const context = await this.buildResolutionContext(message.request, message.collectionId);
      const preflight = this.variableEngine.resolveRequest(message.request, context);
      if (!preflight.ok) {
        this.postError(message.operationId, 'VARIABLE_RESOLUTION_FAILED', message.executionId);
        return false;
      }

      const requestWithAuth = await this.authService.resolveForTransport(
        preflight.request,
        this.collectionManager.getRequest(message.request.id),
        message.request.auth
      );
      const response = await client.execute(requestWithAuth);
      if (execution.cancelled) {
        return true;
      }

      this.postMessage({
        type: 'response',
        operationId: message.operationId,
        executionId: message.executionId,
        response,
      });

      if (response.statusCode > 0) {
        await this.saveToHistory(
          message.request,
          response,
          message.operationId,
          message.executionId,
          message.collectionId
        );
      }
      return true;
    } catch (error) {
      if (!execution.cancelled) {
        const code = error instanceof AuthServiceError && error.code !== 'AUTH_INVALID'
          ? error.code
          : 'OPERATION_FAILED';
        this.postError(message.operationId, code, message.executionId);
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

  private async buildResolutionContext(
    request: JustRequest | null,
    collectionId?: string
  ): Promise<ResolutionContext> {
    const linkedSets = collectionId
      ? this.variableSetManager.getByCollectionId(collectionId)
      : [];
    return {
      requestVars: request?.variables || [],
      collectionVars: collectionId
        ? this.collectionManager.getCollection(collectionId)?.variables || []
        : [],
      setsVars: linkedSets.flatMap(set => set.variables),
      globalVars: await this.loadGlobalVariables(),
    };
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
    executionId: string,
    collectionId?: string
  ): Promise<void> {
    const hasSavedRequest = collectionId !== undefined
      && this.collectionManager.getRequest(request.id) !== undefined;
    const entry = createHistorySummary(request, response, {
      id: randomUUID(),
      timestamp: Date.now(),
      ...(hasSavedRequest ? { requestId: request.id, collectionId } : {}),
    });

    const entries = await this.historyStore.read<HistoryEntry[]>('history') || [];
    entries.unshift(entry);
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

  async runStartupAction(
    action: CommandStartupAction,
    operationId: string
  ): Promise<void> {
    let startupAction: StartupAction;
    if (action.type === 'importCurl') {
      try {
        const parsed = this.curlParser.parseWithWarnings(action.curlString);
        const { request } = await this.authService.stageRecognizedLegacyAuth(parsed.request);
        startupAction = {
          type: 'importCurl',
          request,
          warnings: parsed.warnings,
        };
      } catch (error) {
        if (error instanceof CurlParseError) {
          throw new CommandOperationError(
            'INVALID_CLIPBOARD',
            'The clipboard cURL command could not be parsed.',
            [`${error.code}${error.tokenIndex === undefined ? '' : ` at token ${error.tokenIndex}`}`]
          );
        }
        throw error;
      }
    } else {
      startupAction = action;
    }
    await this.startupActions.enqueue(operationId, startupAction);
  }

  async getCommandCollections(): Promise<Array<{
    id: string;
    name: string;
    requestCount: number;
  }>> {
    await this.loadCollections();
    return this.collectionManager.getCollections().map(collection => ({
      id: collection.id,
      name: collection.name,
      requestCount: this.collectionManager.getRequestsForCollection(collection.id).length,
    }));
  }

  async exportCollectionForCommand(collectionId: string): Promise<{
    collectionId: string;
    name: string;
    json: string;
  }> {
    await this.loadCollections();
    const collection = this.collectionManager.getCollection(collectionId);
    if (!collection) {
      throw new CommandOperationError(
        'INVALID_EXPORT',
        'The selected collection no longer exists. Refresh JustAPI and try again.'
      );
    }
    const requests = this.collectionManager.getRequestsForCollection(collection.id)
      .map(request => this.authService.redactForDerivative(
        this.authService.toPublicRequest(request)
      ));
    const json = JSON.stringify({
      schemaVersion: COLLECTION_TRANSFER_SCHEMA_VERSION,
      collection,
      requests,
    }, null, 2);
    const validation = validateCollectionImportDocument(json);
    if (!validation.ok) {
      throw new CommandOperationError(
        'INVALID_EXPORT',
        'JustAPI could not validate the collection export.',
        validation.details
      );
    }
    return { collectionId: collection.id, name: collection.name, json };
  }

  async importCollectionForCommand(json: string): Promise<{ collectionId: string }> {
    const validation = validateCollectionImportDocument(json);
    if (!validation.ok) {
      throw new CommandOperationError(
        'INVALID_IMPORT',
        'The selected file is not a valid JustAPI collection export.',
        validation.details
      );
    }
    await this.loadCollections();
    const importedRequests = validation.value.requests
      .map(request => this.authService.prepareForImport(request));
    try {
      let imported = false;
      await this.authService.migrateLegacyRequests(importedRequests, async securedRequests => {
        await this.collectionManager.importCollection(validation.value.collection, securedRequests);
        imported = true;
      });
      if (!imported) {
        await this.collectionManager.importCollection(
          validation.value.collection,
          importedRequests
        );
      }
    } catch (error) {
      if (error instanceof CollectionIntegrityError) {
        throw new CommandOperationError(
          'INVALID_IMPORT',
          'The collection conflicts with existing JustAPI data.',
          error.issues.map(issue => issue.entityId
            ? `${issue.code}: ${issue.entityId}`
            : issue.code)
        );
      }
      throw error;
    }
    return { collectionId: validation.value.collection.id };
  }

  async dispose(): Promise<void> {
    this.disposeViewListeners();
    this.startupActions.dispose();
    this.executions.cancelAll();
    await Promise.all([
      this.authService.dispose(),
      ...this.stores.map(async store => await store.dispose()),
    ]);
  }

  private async confirmCredentialDisclosure(destination: string): Promise<boolean> {
    return this.authService.confirmDisclosure(destination, async disclosure => {
      const choice = await vscode.window.showWarningMessage(
        disclosure.warning,
        { modal: true },
        'Include once'
      );
      return choice === 'Include once';
    });
  }

  private reportStorageFailure(failure: StorageFailure): void {
    const message = failure.recovered
      ? `JustAPI recovered ${failure.key} storage from a verified backup.`
      : `JustAPI ${failure.key} storage requires attention: ${failure.message}`;
    if (failure.recovered) {
      void vscode.window.showWarningMessage(message);
    } else {
      void vscode.window.showErrorMessage(message);
    }
  }

  private async postStartupAction(
    operationId: string,
    action: StartupAction
  ): Promise<boolean> {
    const message: ExtensionMessage = { type: 'startupAction', operationId, action };
    const validation = validateExtensionMessage(message);
    if (!validation.ok || !this.view) {
      return false;
    }
    return await this.view.webview.postMessage(validation.value);
  }

  private disposeViewListeners(): void {
    for (const disposable of this.viewDisposables.splice(0)) {
      disposable.dispose();
    }
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

  private postError(
    operationId: string,
    code: ProtocolErrorCode,
    executionId?: string,
    details?: string[]
  ): void {
    const error = protocolFailure(code);
    this.postMessage({
      type: 'error',
      operationId,
      ...(executionId ? { executionId } : {}),
      ...(details && details.length > 0 ? { details } : {}),
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
