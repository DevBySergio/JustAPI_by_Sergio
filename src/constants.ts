export const EXTENSION_ID = 'justapi';

export const ViewId = {
  ACTIVITY_CONTAINER: 'justapi-activity',
  SIDEBAR: 'justapi.sidebar',
} as const;

export const COLLECTIONS_VIEW_ID = 'justapi.collections';
export const HISTORY_VIEW_ID = 'justapi.history';

export const STORAGE_KEYS = {
  COLLECTIONS: 'justapi.collections',
  HISTORY: 'justapi.history',
  GLOBAL_VARIABLES: 'justapi.globalVariables',
  SETTINGS: 'justapi.settings',
  WORKSPACE_CONFIG: 'justapi.workspaceConfig',
} as const;

export const MAX_HISTORY_ENTRIES = 200;
export const DEFAULT_TIMEOUT = 30000;

export const COMMANDS = {
  CREATE_REQUEST: 'justapi.createRequest',
  SEND_REQUEST: 'justapi.sendRequest',
  IMPORT_CURL: 'justapi.importCurl',
  EXPORT_COLLECTION: 'justapi.exportCollection',
  IMPORT_COLLECTION: 'justapi.importCollection',
  OPEN_HISTORY: 'justapi.openHistory',
  CREATE_VARIABLE: 'justapi.createVariable',
  GENERATE_CODE: 'justapi.generateCode',
} as const;
