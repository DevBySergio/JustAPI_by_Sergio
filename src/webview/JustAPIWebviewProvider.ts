import * as vscode from 'vscode';
import { CodeGenerator } from '../commands/CodeGenerator';
import {
  CommandOperationError,
  CommandStartupAction,
} from '../commands/CommandController';
import { StartupActionQueue } from '../commands/StartupActionQueue';
import { ViewId } from '../constants';
import { AuthService } from '../engine/auth/AuthService';
import { CollectionIntegrityError } from '../engine/collection/CollectionGraph';
import { CollectionManager } from '../engine/collection/CollectionManager';
import { CurlParser } from '../engine/http/CurlParser';
import { VariableEngine } from '../engine/variables/VariableEngine';
import { VariableSetManager } from '../engine/variables/VariableSetManager';
import { ExtensionMessage, StartupAction } from '../models/MessageProtocol';
import { validateExtensionMessage } from '../protocol/MessageValidator';
import { WebviewMessageRouter, WebviewProtocol } from '../protocol/WebviewProtocol';
import { CodeGenerationService } from '../services/CodeGenerationService';
import {
  CollectionService,
  CollectionTransferError,
} from '../services/CollectionService';
import { HistoryService } from '../services/HistoryService';
import { PersistenceService } from '../services/PersistenceService';
import { RequestPreparationService } from '../services/RequestPreparationService';
import { RequestService } from '../services/RequestService';
import { JsonFileStore, StorageFailure } from '../storage/JsonFileStore';
import { normalizeHistoryData } from '../storage/HistorySummary';
import { renderWebviewDocument } from './WebviewDocument';
import { WebviewMessageHandler } from './WebviewMessageHandler';

export class JustAPIWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = ViewId.SIDEBAR;

  private view?: vscode.WebviewView;
  private readonly stores: JsonFileStore[];
  private readonly authService: AuthService;
  private readonly startupActions: StartupActionQueue<StartupAction>;
  private readonly messageHandler: WebviewMessageHandler;
  private readonly messageRouter: WebviewMessageRouter;
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
    const collectionStore = workspaceStore ?? globalStore;
    const historyStore = workspaceStore
      ? new JsonFileStore(workspaceStore.getBasePath(), storageOptions)
      : globalStore;
    this.stores = Array.from(new Set([
      collectionStore,
      historyStore,
      globalStore,
    ]));

    this.authService = new AuthService(context.secrets);
    const collectionManager = new CollectionManager(collectionStore, {
      duplicateRequest: (request, newRequestId) =>
        this.authService.duplicateRequest(request, newRequestId),
      afterRemove: (removed, remaining) =>
        this.authService.cleanupRemovedRequests(removed, remaining),
    });
    const collections = new CollectionService(collectionManager, this.authService);
    const variableSets = new VariableSetManager(collectionStore);
    const persistence = new PersistenceService(globalStore, globalStore);
    const history = new HistoryService(historyStore);
    const preparation = new RequestPreparationService(
      new VariableEngine(),
      collections,
      variableSets,
      persistence,
      this.authService
    );
    const protocol = new WebviewProtocol(message => {
      void this.view?.webview.postMessage(message);
    });
    const confirmDisclosure = async (destination: string): Promise<boolean> => (
      await this.confirmCredentialDisclosure(destination)
    );
    const requests = new RequestService(preparation, collections, history);
    const codeGeneration = new CodeGenerationService(
      new CodeGenerator(),
      preparation,
      collections,
      this.authService,
      confirmDisclosure
    );
    this.startupActions = new StartupActionQueue(async (operationId, action) => (
      await this.postStartupAction(operationId, action)
    ));
    this.messageHandler = new WebviewMessageHandler({
      protocol,
      collections,
      history,
      persistence,
      requestPreparation: preparation,
      requests,
      codeGeneration,
      variableSets,
      curlParser: new CurlParser(),
      startupActions: this.startupActions,
      confirmDisclosure,
      showJsonDocument: async json => await this.showJsonDocument(json),
    });
    this.messageRouter = new WebviewMessageRouter(
      protocol,
      async message => await this.messageHandler.dispatch(message),
      undefined,
      message => this.messageHandler.finalize(message)
    );
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.disposeViewListeners();
    this.view = webviewView;
    this.startupActions.resetForNewTarget();

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
      ],
    };
    webviewView.webview.html = renderWebviewDocument(
      webviewView.webview,
      this.extensionUri
    );
    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
        await this.messageRouter.handle(message);
      })
    );
    await this.messageHandler.initialize();
  }

  async runStartupAction(
    action: CommandStartupAction,
    operationId: string
  ): Promise<void> {
    await this.messageHandler.runStartupAction(action, operationId);
  }

  async getCommandCollections(): Promise<Array<{
    id: string;
    name: string;
    requestCount: number;
  }>> {
    return await this.messageHandler.getCommandCollections();
  }

  async exportCollectionForCommand(collectionId: string): Promise<{
    collectionId: string;
    name: string;
    json: string;
  }> {
    try {
      return await this.messageHandler.exportCollectionForCommand(collectionId);
    } catch (error) {
      if (error instanceof CollectionTransferError) {
        throw new CommandOperationError(
          'INVALID_EXPORT',
          'JustAPI could not validate the collection export.',
          error.details
        );
      }
      if (error instanceof Error && error.message === 'Collection not found') {
        throw new CommandOperationError(
          'INVALID_EXPORT',
          'The selected collection no longer exists. Refresh JustAPI and try again.'
        );
      }
      throw error;
    }
  }

  async importCollectionForCommand(json: string): Promise<{ collectionId: string }> {
    try {
      return await this.messageHandler.importCollectionForCommand(json);
    } catch (error) {
      if (error instanceof CollectionTransferError) {
        throw new CommandOperationError(
          'INVALID_IMPORT',
          'The selected file is not a valid JustAPI collection export.',
          error.details
        );
      }
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
  }

  async dispose(): Promise<void> {
    this.disposeViewListeners();
    this.messageHandler.dispose();
    await Promise.all([
      this.authService.dispose(),
      ...this.stores.map(async store => await store.dispose()),
    ]);
  }

  private async confirmCredentialDisclosure(destination: string): Promise<boolean> {
    return await this.authService.confirmDisclosure(destination, async disclosure => {
      const choice = await vscode.window.showWarningMessage(
        disclosure.warning,
        { modal: true },
        'Include once'
      );
      return choice === 'Include once';
    });
  }

  private async showJsonDocument(json: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      content: json,
      language: 'json',
    });
    await vscode.window.showTextDocument(document);
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
}
