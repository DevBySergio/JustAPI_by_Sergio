import { JustRequest } from './Request';
import { JustResponse } from './Response';
import { Collection } from './Collection';
import { Variable } from './Variable';
import { VariableSet } from './VariableSet';
import { HistoryEntry } from './HistoryEntry';

// Messages from Webview → Extension Host
export type WebviewMessage =
  | { type: 'executeRequest'; request: JustRequest; collectionId?: string }
  | { type: 'cancelRequest' }
  | { type: 'saveRequest'; request: JustRequest; collectionId: string; parentId?: string }
  | { type: 'deleteRequest'; requestId: string; collectionId: string }
  | { type: 'getCollections' }
  | { type: 'getRequest'; requestId: string }
  | { type: 'createCollection'; name: string }
  | { type: 'updateCollection'; collection: Collection }
  | { type: 'deleteCollection'; collectionId: string }
  | { type: 'duplicateCollection'; collectionId: string }
  | { type: 'renameCollection'; collectionId: string; name: string }
  | { type: 'moveItem'; itemId: string; sourceCollectionId: string; targetCollectionId: string; targetParentId?: string }
  | { type: 'getHistory'; filter?: string; limit?: number }
  | { type: 'clearHistory' }
  | { type: 'deleteHistoryEntry'; entryId: string }
  | { type: 'getVariables' }
  | { type: 'setGlobalVariables'; variables: Variable[] }
  | { type: 'setCollectionVariables'; collectionId: string; variables: Variable[] }
  | { type: 'getSettings' }
  | { type: 'setSettings'; settings: Record<string, unknown> }
  | { type: 'search'; query: string }
  | { type: 'importCurl'; curlString: string }
  | { type: 'exportCollection'; collectionId: string }
  | { type: 'importCollection'; json: string }
  | { type: 'generateCode'; request: JustRequest; language: string }
  | { type: 'getWorkspaceCollections' }
  | { type: 'setWorkspaceEnabled'; enabled: boolean }
  | { type: 'webviewReady' }
  | { type: 'previewResolution'; request: JustRequest | null; collectionId?: string }
  | { type: 'getVariableSets' }
  | { type: 'createVariableSet'; name: string }
  | { type: 'updateVariableSet'; set: VariableSet }
  | { type: 'deleteVariableSet'; setId: string }
  | { type: 'linkVariableSet'; setId: string; collectionId: string }
  | { type: 'unlinkVariableSet'; setId: string; collectionId: string };

// Messages from Extension Host → Webview
export type ExtensionMessage =
  | { type: 'collections'; collections: Collection[] }
  | { type: 'collection'; collection: Collection }
  | { type: 'requestLoaded'; request: JustRequest }
  | { type: 'history'; entries: HistoryEntry[] }
  | { type: 'historyEntry'; entry: HistoryEntry }
  | { type: 'response'; response: JustResponse }
  | { type: 'variables'; variables: Variable[] }
  | { type: 'collectionVariables'; collectionId: string; variables: Variable[] }
  | { type: 'settings'; settings: Record<string, unknown> }
  | { type: 'searchResults'; results: SearchResult[] }
  | { type: 'curlImportResult'; request: JustRequest }
  | { type: 'codeGenerationResult'; code: string; language: string }
  | { type: 'error'; message: string; code?: string }
  | { type: 'workspaceEnabled'; enabled: boolean }
  | { type: 'requestExecuting'; executing: boolean }
  | { type: 'initialState'; state: InitialState }
  | { type: 'variableSets'; sets: VariableSet[] }
  | { type: 'variableSetUpdated'; set: VariableSet }
  | { type: 'resolutionPreview'; resolvedUrl: string; resolvedHeaders: string; resolvedBody: string }
  | { type: 'createNewRequest' };

export interface InitialState {
  collections: Collection[];
  history: HistoryEntry[];
  variables: Variable[];
  variableSets: VariableSet[];
  settings: Record<string, unknown>;
  workspaceEnabled: boolean;
}

export interface SearchResult {
  type: 'collection' | 'folder' | 'request';
  id: string;
  name: string;
  collectionId?: string;
  url?: string;
  matchField: 'name' | 'url' | 'variable' | 'header';
}
