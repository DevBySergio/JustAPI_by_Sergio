import { RequestFileService } from '../services/RequestFileService';
import { ResponseDownloadService } from '../services/ResponseDownloadService';
import { PostmanImportService } from '../services/PostmanImportService';
import { CurlParseError, CurlParser } from '../engine/http/CurlParser';
import { VariableSetManager } from '../engine/variables/VariableSetManager';
import {
  CommandOperationError,
  CommandStartupAction,
} from '../commands/CommandController';
import { StartupActionQueue } from '../commands/StartupActionQueue';
import { ExtensionMessage, StartupAction, WebviewMessage } from '../models/MessageProtocol';
import { WebviewProtocol } from '../protocol/WebviewProtocol';
import { ApplicationError } from '../services/ApplicationError';
import { CodeGenerationService } from '../services/CodeGenerationService';
import { CollectionExport, CollectionService } from '../services/CollectionService';
import { HistoryService } from '../services/HistoryService';
import { PersistenceService } from '../services/PersistenceService';
import { RequestPreparation } from '../services/RequestPreparationService';
import { RequestService } from '../services/RequestService';
import { EnvironmentFileService } from '../services/EnvironmentFileService';
import { buildSearchResults } from './SearchIndex';

export interface WebviewMessageHandlerOptions {
  protocol: WebviewProtocol;
  collections: CollectionService;
  history: HistoryService;
  persistence: PersistenceService;
  requestPreparation: RequestPreparation;
  requests: RequestService;
  codeGeneration: CodeGenerationService;
  variableSets: VariableSetManager;
  curlParser: CurlParser;
  startupActions: StartupActionQueue<StartupAction>;
  confirmDisclosure: (destination: string) => Promise<boolean>;
  showJsonDocument: (json: string) => Promise<void>;
  requestFiles?: RequestFileService;
  responseDownloads?: ResponseDownloadService;
  postmanImports?: PostmanImportService;
  environmentFiles?: EnvironmentFileService;
}

export class WebviewMessageHandler {
  constructor(private readonly options: WebviewMessageHandlerOptions) {}

  async resetForNewView(): Promise<void> {
    this.options.requestFiles?.reset();
    this.options.postmanImports?.reset();
    this.options.environmentFiles?.reset();
    this.options.requests.dispose();
    await this.options.collections.discardAllPendingAuth();
  }

  async initialize(): Promise<void> {
    await this.options.collections.load();
    await this.options.variableSets.load();
  }

  async dispatch(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'webviewReady':
        await this.sendInitialState(message.operationId);
        this.options.startupActions.setReady(true);
        return;

      case 'startupActionHandled':
        if (!this.options.startupActions.complete(message.operationId)) {
          throw new ApplicationError('OPERATION_FAILED');
        }
        return;

      case 'executeRequest':
        await this.options.requests.execute(message, event => this.options.protocol.post(event));
        return;

      case 'selectRequestFile': {
        if (!this.options.requestFiles) { throw new ApplicationError('OPERATION_FAILED'); }
        const file = await this.options.requestFiles.select(message.requestId, message.fieldId);
        if (file) { this.options.protocol.post({ type: 'requestFileSelected', operationId: message.operationId, requestId: message.requestId, ...(message.fieldId ? { fieldId: message.fieldId } : {}), file }); } return;
      }
      case 'releaseRequestFiles': this.options.requestFiles?.releaseRequest(message.requestId); return;
      case 'saveResponseBody': {
        if (!this.options.responseDownloads) { throw new ApplicationError('RESPONSE_BODY_UNAVAILABLE'); }
        const result = await this.options.responseDownloads.save(message.responseId);
        this.options.protocol.post({ type: 'responseDownloadResult', operationId: message.operationId, ...result }); return;
      }
      case 'releaseResponseBody': {
        const responseIds = this.options.responseDownloads?.release(message.responseId) ?? [];
        if (responseIds.length) { this.options.protocol.post({ type: 'responseBodiesReleased', operationId: message.operationId, responseIds }); }
        return;
      }
      case 'cancelRequest':
        this.options.requests.cancel(
          message.operationId,
          message.executionId,
          event => this.options.protocol.post(event)
        );
        return;

      case 'saveRequest': {
        const saved = await this.options.collections.saveRequest(
          message.request,
          message.collectionId,
          message.parentId
        );
        this.postCollections(message.operationId);
        if (saved) {
          this.options.protocol.post({
            type: 'requestSaved',
            operationId: message.operationId,
            request: saved,
          });
        }
        return;
      }

      case 'deleteRequest':
        await this.options.collections.deleteRequest(message.requestId, message.collectionId);
        this.postCollections(message.operationId);
        return;

      case 'configureAuth': {
        const auth = await this.options.collections.configureAuth(message.requestId, message.auth);
        this.options.protocol.post({
          type: 'requestAuthUpdated',
          operationId: message.operationId,
          requestId: message.requestId,
          auth,
          pending: this.options.collections.hasPendingAuth(message.requestId),
        });
        return;
      }

      case 'discardRequestChanges':
        await this.options.collections.discardRequestChanges(message.requestId);
        return;

      case 'setCollectionVariables':
        await this.options.collections.updateCollectionVariables(message.collectionId, message.variables);
        this.postCollections(message.operationId);
        return;

      case 'getCollections':
        this.postCollections(message.operationId);
        return;

      case 'getRequest': {
        const request = this.options.collections.getRequest(message.requestId);
        if (!request) {
          throw new ApplicationError('OPERATION_FAILED');
        }
        this.options.protocol.post({
          type: 'requestLoaded',
          operationId: message.operationId,
          request,
        });
        return;
      }

      case 'createCollection':
        await this.options.collections.createCollection(message.name);
        this.postCollections(message.operationId);
        return;

      case 'updateCollection':
        await this.options.collections.updateCollection(message.collection);
        this.postCollections(message.operationId);
        return;

      case 'deleteCollection':
        await this.options.collections.deleteCollection(message.collectionId);
        this.postCollections(message.operationId);
        return;

      case 'duplicateCollection':
        await this.options.collections.duplicateCollection(message.collectionId);
        this.postCollections(message.operationId);
        return;

      case 'renameCollection':
        await this.options.collections.renameCollection(message.collectionId, message.name);
        this.postCollections(message.operationId);
        return;

      case 'moveItem':
        await this.options.collections.moveItem(
          message.itemId,
          message.sourceCollectionId,
          message.targetCollectionId,
          message.targetParentId,
          message.targetIndex
        );
        this.postCollections(message.operationId);
        return;

      case 'createFolder':
        await this.options.collections.createFolder(message.collectionId, message.name, message.parentId);
        this.postCollections(message.operationId);
        return;

      case 'renameFolder':
        await this.options.collections.renameFolder(message.collectionId, message.folderId, message.name);
        this.postCollections(message.operationId);
        return;

      case 'deleteFolder':
        await this.options.collections.deleteFolder(message.collectionId, message.folderId);
        this.postCollections(message.operationId);
        return;

      case 'getHistory': {
        const entries = await this.options.history.list(message.filter, message.limit);
        this.options.protocol.post({
          type: 'history',
          operationId: message.operationId,
          entries,
        });
        return;
      }

      case 'clearHistory':
        this.options.protocol.post({
          type: 'history',
          operationId: message.operationId,
          entries: await this.options.history.clear(),
        });
        return;

      case 'deleteHistoryEntry':
        this.options.protocol.post({
          type: 'history',
          operationId: message.operationId,
          entries: await this.options.history.delete(message.entryId),
        });
        return;

      case 'getVariables':
        this.options.protocol.post({
          type: 'variables',
          operationId: message.operationId,
          variables: await this.options.persistence.loadVariables(),
        });
        return;

      case 'setGlobalVariables':
        await this.options.persistence.saveVariables(message.variables);
        return;

      case 'getSettings':
        this.options.protocol.post({
          type: 'settings',
          operationId: message.operationId,
          settings: await this.options.persistence.loadSettings(),
        });
        return;

      case 'setSettings':
        await this.options.persistence.saveSettings(message.settings);
        return;

      case 'search': {
        const history = await this.options.history.list();
        const results = buildSearchResults(
          this.options.collections.getCollections(),
          requestId => this.options.collections.getPersistedRequest(requestId),
          history,
          message.query
        );
        this.options.protocol.post({
          type: 'searchResults',
          operationId: message.operationId,
          results,
        });
        return;
      }

      case 'importCurl': {
        const parsed = this.options.curlParser.parseWithWarnings(message.curlString);
        const request = await this.options.collections.stageImportedRequest(parsed.request);
        this.options.protocol.post({
          type: 'curlImportResult',
          operationId: message.operationId,
          request,
          warnings: parsed.warnings,
        });
        return;
      }

      case 'cancelCurlImport':
        await this.options.collections.cancelImportedRequest(message.requestId);
        return;

      case 'exportCollection': {
        const exported = await this.options.collections.exportDocument(
          message.collectionId,
          message.includeCredentials === true,
          this.options.confirmDisclosure
        );
        await this.options.showJsonDocument(exported.json);
        return;
      }

      case 'importCollection':
        await this.options.collections.importDocument(message.json);
        this.postCollections(message.operationId);
        return;

      case 'generateCode': {
        const result = await this.options.codeGeneration.generate(
          message.request,
          message.language,
          message.collectionId,
          message.includeCredentials
        );
        this.options.protocol.post({
          type: 'codeGenerationResult',
          operationId: message.operationId,
          ...result,
        });
        return;
      }

      case 'previewResolution':
        this.options.protocol.post({
          type: 'resolutionPreview',
          operationId: message.operationId,
          ...await this.options.requestPreparation.preview(
            message.request,
            message.collectionId
          ),
        });
        return;

      case 'getVariableSets':
        this.postVariableSets(message.operationId);
        return;

      case 'createVariableSet':
        await this.options.variableSets.create(message.name, message.kind);
        this.postVariableSets(message.operationId);
        return;

      case 'selectEnvironment':
        await this.options.variableSets.selectEnvironment(message.setId);
        this.postVariableSets(message.operationId);
        return;
      case 'previewPostmanImport': {
        const preview = await this.options.postmanImports?.preview();
        if (preview) { this.options.protocol.post({ type: 'postmanImportPreview', operationId: message.operationId, preview }); }
        return;
      }
      case 'confirmPostmanImport':
        if (!this.options.postmanImports) { throw new ApplicationError('IMPORT_ERROR'); }
        await this.options.postmanImports.confirm(message.previewId, message.name, message.acceptWarnings);
        this.postCollections(message.operationId); this.postVariableSets(message.operationId); return;
      case 'cancelPostmanImport': this.options.postmanImports?.cancel(message.previewId); return;
      case 'previewEnvFile': {
        const preview = await this.options.environmentFiles?.preview(message.setId);
        if (preview) { this.options.protocol.post({ type: 'envImportPreview', operationId: message.operationId, preview }); }
        return;
      }
      case 'confirmEnvImport':
        if (!this.options.environmentFiles) { throw new ApplicationError('IMPORT_ERROR'); }
        await this.options.environmentFiles.confirm(message.previewId, message.name, message.watch);
        this.postVariableSets(message.operationId); this.postEnvWatches(message.operationId);
        return;
      case 'cancelEnvImport': this.options.environmentFiles?.cancel(message.previewId); return;
      case 'stopEnvWatch':
        this.options.environmentFiles?.stop(message.setId); this.postEnvWatches(message.operationId); return;

      case 'updateVariableSet':
        await this.options.variableSets.update(message.set);
        this.postVariableSets(message.operationId);
        return;

      case 'deleteVariableSet':
        await this.options.variableSets.delete(message.setId);
        this.options.environmentFiles?.stop(message.setId); this.postEnvWatches(message.operationId);
        this.postVariableSets(message.operationId);
        return;

      case 'linkVariableSet':
        await this.options.variableSets.linkToCollection(message.setId, message.collectionId);
        this.postVariableSets(message.operationId);
        return;

      case 'unlinkVariableSet':
        await this.options.variableSets.unlinkFromCollection(message.setId, message.collectionId);
        this.postVariableSets(message.operationId);
        return;
    }
  }

  finalize(message: WebviewMessage): void {
    if (message.type === 'executeRequest') {
      this.options.requests.finalize(
        message.operationId,
        message.executionId,
        event => this.options.protocol.post(event)
      );
    }
  }

  async runStartupAction(
    action: CommandStartupAction,
    operationId: string
  ): Promise<void> {
    let startupAction: StartupAction;
    if (action.type === 'importCurl') {
      try {
        const parsed = this.options.curlParser.parseWithWarnings(action.curlString);
        startupAction = {
          type: 'importCurl',
          request: await this.options.collections.stageImportedRequest(parsed.request),
          warnings: parsed.warnings,
        };
      } catch (error) {
        if (error instanceof CurlParseError) {
          const suffix = error.tokenIndex === undefined ? '' : ` at token ${error.tokenIndex}`;
          throw new CommandOperationError(
            'INVALID_CLIPBOARD',
            'The clipboard cURL command could not be parsed.',
            [`${error.code}${suffix}`]
          );
        }
        throw error;
      }
    } else {
      startupAction = action;
    }
    await this.options.startupActions.enqueue(operationId, startupAction);
  }

  async getCommandCollections(): Promise<Array<{
    id: string;
    name: string;
    requestCount: number;
  }>> {
    await this.options.collections.load();
    return this.options.collections.getCollections().map(collection => ({
      id: collection.id,
      name: collection.name,
      requestCount: this.options.collections.getRequestsForCollection(collection.id).length,
    }));
  }

  async exportCollectionForCommand(collectionId: string): Promise<CollectionExport> {
    await this.options.collections.load();
    return await this.options.collections.exportDocument(
      collectionId,
      false,
      this.options.confirmDisclosure
    );
  }

  async importCollectionForCommand(json: string): Promise<{ collectionId: string }> {
    await this.options.collections.load();
    return await this.options.collections.importDocument(json);
  }

  async dispose(): Promise<void> {
    this.options.requestFiles?.reset();
    this.options.postmanImports?.reset();
    this.options.environmentFiles?.reset();
    this.options.requests.dispose();
    this.options.startupActions.dispose();
    await Promise.all([
      this.options.collections.dispose(),
      this.options.history.dispose(),
      this.options.variableSets.dispose(),
    ]);
  }

  private async sendInitialState(operationId: string): Promise<void> {
    await this.initialize();
    const domains: ExtensionMessage[] = [
      { type: 'collections', operationId, collections: this.options.collections.getCollections() },
      { type: 'history', operationId, entries: await this.options.history.list() },
      { type: 'variables', operationId, variables: await this.options.persistence.loadVariables() },
      { type: 'variableSets', operationId, sets: this.options.variableSets.getAll() },
      { type: 'settings', operationId, settings: await this.options.persistence.loadSettings() },
    ];
    if (this.options.environmentFiles) { domains.push({ type: 'envWatches', operationId, watches: this.options.environmentFiles.getWatches() }); }
    for (const domain of domains) {
      if (!this.options.protocol.post(domain)) { throw new ApplicationError('OUTBOUND_MESSAGE_INVALID'); }
    }
    this.options.protocol.post({ type: 'initializationComplete', operationId });
  }

  private postCollections(operationId: string): void {
    this.options.protocol.post({
      type: 'collections',
      operationId,
      collections: this.options.collections.getCollections(),
    });
  }

  private postEnvWatches(operationId: string): void {
    if (this.options.environmentFiles) { this.options.protocol.post({ type: 'envWatches', operationId, watches: this.options.environmentFiles.getWatches() }); }
  }

  private postVariableSets(operationId: string): void {
    this.options.protocol.post({
      type: 'variableSets',
      operationId,
      sets: this.options.variableSets.getAll(),
    });
  }
}
