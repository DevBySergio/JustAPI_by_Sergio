import { JustRequest } from './Request';
import { JustResponse } from './Response';
import { Collection } from './Collection';
import { Variable } from './Variable';
import { VariableSet } from './VariableSet';
import { HistoryEntry } from './HistoryEntry';
import { AuthConfig, AuthInput } from './Auth';
import { VariableDiagnostic } from './VariableResolution';

export type CodeTargetLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'curl'
  | 'csharp'
  | 'java'
  | 'go';

export type ProtocolErrorCode =
  | 'INVALID_MESSAGE'
  | 'UNKNOWN_MESSAGE'
  | 'MESSAGE_TOO_LARGE'
  | 'INVALID_PAYLOAD'
  | 'DUPLICATE_OPERATION'
  | 'DUPLICATE_EXECUTION'
  | 'EXECUTION_NOT_FOUND'
  | 'IMPORT_ERROR'
  | 'AUTH_CONFLICT'
  | 'AUTH_SECRET_NOT_FOUND'
  | 'VARIABLE_RESOLUTION_FAILED'
  | 'OPERATION_FAILED'
  | 'OUTBOUND_MESSAGE_INVALID';

interface OperationMessage {
  operationId: string;
}

interface ExecutionMessage extends OperationMessage {
  executionId: string;
}

// Messages from Webview → Extension Host. Every message is one correlated operation.
export type WebviewMessage =
  | ({ type: 'executeRequest'; request: JustRequest; collectionId?: string } & ExecutionMessage)
  | ({ type: 'cancelRequest' } & ExecutionMessage)
  | ({ type: 'saveRequest'; request: JustRequest; collectionId: string; parentId?: string } & OperationMessage)
  | ({ type: 'deleteRequest'; requestId: string; collectionId: string } & OperationMessage)
  | ({ type: 'configureAuth'; requestId: string; auth: AuthInput } & OperationMessage)
  | ({ type: 'getCollections' } & OperationMessage)
  | ({ type: 'getRequest'; requestId: string } & OperationMessage)
  | ({ type: 'createCollection'; name: string } & OperationMessage)
  | ({ type: 'updateCollection'; collection: Collection } & OperationMessage)
  | ({ type: 'deleteCollection'; collectionId: string } & OperationMessage)
  | ({ type: 'duplicateCollection'; collectionId: string } & OperationMessage)
  | ({ type: 'renameCollection'; collectionId: string; name: string } & OperationMessage)
  | ({
      type: 'moveItem';
      itemId: string;
      sourceCollectionId: string;
      targetCollectionId: string;
      targetParentId?: string;
    } & OperationMessage)
  | ({ type: 'getHistory'; filter?: string; limit?: number } & OperationMessage)
  | ({ type: 'clearHistory' } & OperationMessage)
  | ({ type: 'deleteHistoryEntry'; entryId: string } & OperationMessage)
  | ({ type: 'getVariables' } & OperationMessage)
  | ({ type: 'setGlobalVariables'; variables: Variable[] } & OperationMessage)
  | ({ type: 'getSettings' } & OperationMessage)
  | ({ type: 'setSettings'; settings: Record<string, unknown> } & OperationMessage)
  | ({ type: 'search'; query: string } & OperationMessage)
  | ({ type: 'importCurl'; curlString: string } & OperationMessage)
  | ({ type: 'exportCollection'; collectionId: string; includeCredentials?: boolean } & OperationMessage)
  | ({ type: 'importCollection'; json: string } & OperationMessage)
  | ({
      type: 'generateCode';
      request: JustRequest;
      language: CodeTargetLanguage;
      includeCredentials?: boolean;
      collectionId?: string;
    } & OperationMessage)
  | ({ type: 'webviewReady' } & OperationMessage)
  | ({ type: 'previewResolution'; request: JustRequest | null; collectionId?: string } & OperationMessage)
  | ({ type: 'getVariableSets' } & OperationMessage)
  | ({ type: 'createVariableSet'; name: string } & OperationMessage)
  | ({ type: 'updateVariableSet'; set: VariableSet } & OperationMessage)
  | ({ type: 'deleteVariableSet'; setId: string } & OperationMessage)
  | ({ type: 'linkVariableSet'; setId: string; collectionId: string } & OperationMessage)
  | ({ type: 'unlinkVariableSet'; setId: string; collectionId: string } & OperationMessage);

export type WebviewMessageType = WebviewMessage['type'];

// Messages from Extension Host → Webview. Responses always echo the originating ID.
export type ExtensionMessage =
  | ({ type: 'collections'; collections: Collection[] } & OperationMessage)
  | ({ type: 'requestLoaded'; request: JustRequest } & OperationMessage)
  | ({ type: 'requestAuthUpdated'; requestId: string; auth: AuthConfig } & OperationMessage)
  | ({ type: 'history'; entries: HistoryEntry[] } & OperationMessage)
  | ({ type: 'historyEntry'; entry: HistoryEntry } & ExecutionMessage)
  | ({ type: 'response'; response: JustResponse } & ExecutionMessage)
  | ({ type: 'variables'; variables: Variable[] } & OperationMessage)
  | ({ type: 'settings'; settings: Record<string, unknown> } & OperationMessage)
  | ({ type: 'searchResults'; results: SearchResult[] } & OperationMessage)
  | ({ type: 'curlImportResult'; request: JustRequest } & OperationMessage)
  | ({ type: 'codeGenerationResult'; code: string; language: CodeTargetLanguage } & OperationMessage)
  | ({
      type: 'error';
      message: string;
      code: ProtocolErrorCode;
      executionId?: string;
    } & OperationMessage)
  | ({ type: 'requestExecuting'; executing: boolean } & ExecutionMessage)
  | ({ type: 'initialState'; state: InitialState } & OperationMessage)
  | ({ type: 'variableSets'; sets: VariableSet[] } & OperationMessage)
  | ({
      type: 'resolutionPreview';
      resolvedUrl: string;
      resolvedHeaders: string;
      resolvedQueryParams: string;
      resolvedBody: string;
      diagnostics: VariableDiagnostic[];
      canExecute: boolean;
    } & OperationMessage)
  | ({ type: 'createNewRequest' } & OperationMessage)
  | ({
      type: 'acknowledgement';
      action: WebviewMessageType;
      status: 'completed';
      executionId?: string;
    } & OperationMessage);

export interface InitialState {
  collections: Collection[];
  history: HistoryEntry[];
  variables: Variable[];
  variableSets: VariableSet[];
  settings: Record<string, unknown>;
}

export interface SearchResult {
  type: 'collection' | 'folder' | 'request';
  id: string;
  name: string;
  collectionId?: string;
  url?: string;
  matchField: 'name' | 'url' | 'variable' | 'header';
}
