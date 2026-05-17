"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMANDS = exports.DEFAULT_TIMEOUT = exports.MAX_HISTORY_ENTRIES = exports.STORAGE_KEYS = exports.HISTORY_VIEW_ID = exports.COLLECTIONS_VIEW_ID = exports.ViewId = exports.EXTENSION_ID = void 0;
exports.EXTENSION_ID = 'justapi';
exports.ViewId = {
    SIDEBAR: 'justapi.sidebar',
};
exports.COLLECTIONS_VIEW_ID = 'justapi.collections';
exports.HISTORY_VIEW_ID = 'justapi.history';
exports.STORAGE_KEYS = {
    COLLECTIONS: 'justapi.collections',
    HISTORY: 'justapi.history',
    GLOBAL_VARIABLES: 'justapi.globalVariables',
    SETTINGS: 'justapi.settings',
    WORKSPACE_CONFIG: 'justapi.workspaceConfig',
};
exports.MAX_HISTORY_ENTRIES = 200;
exports.DEFAULT_TIMEOUT = 30000;
exports.COMMANDS = {
    CREATE_REQUEST: 'justapi.createRequest',
    SEND_REQUEST: 'justapi.sendRequest',
    IMPORT_CURL: 'justapi.importCurl',
    EXPORT_COLLECTION: 'justapi.exportCollection',
    IMPORT_COLLECTION: 'justapi.importCollection',
    OPEN_HISTORY: 'justapi.openHistory',
    CREATE_VARIABLE: 'justapi.createVariable',
    GENERATE_CODE: 'justapi.generateCode',
};
//# sourceMappingURL=constants.js.map