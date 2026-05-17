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
exports.registerCommands = registerCommands;
const vscode = __importStar(require("vscode"));
const constants_1 = require("../constants");
function registerCommands(context, provider) {
    context.subscriptions.push(vscode.commands.registerCommand(constants_1.COMMANDS.CREATE_REQUEST, () => {
        vscode.commands.executeCommand('workbench.view.extension.justapi-sidebar');
        provider.createNewRequest();
    }), vscode.commands.registerCommand(constants_1.COMMANDS.IMPORT_CURL, async () => {
        const clipboard = await vscode.env.clipboard.readText();
        if (clipboard.trim().toLowerCase().startsWith('curl')) {
            vscode.commands.executeCommand('workbench.view.extension.justapi-sidebar');
            // The provider will handle the curl import
            provider.postCurlImport(clipboard);
        }
        else {
            vscode.window.showInformationMessage('Clipboard does not contain a cURL command');
        }
    }), vscode.commands.registerCommand(constants_1.COMMANDS.EXPORT_COLLECTION, () => {
        vscode.commands.executeCommand('workbench.view.extension.justapi-sidebar');
    }), vscode.commands.registerCommand(constants_1.COMMANDS.OPEN_HISTORY, () => {
        vscode.commands.executeCommand('workbench.view.extension.justapi-sidebar');
    }), vscode.commands.registerCommand(constants_1.COMMANDS.CREATE_VARIABLE, () => {
        vscode.commands.executeCommand('workbench.view.extension.justapi-sidebar');
    }));
}
//# sourceMappingURL=registerCommands.js.map