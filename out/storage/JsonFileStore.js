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
exports.JsonFileStore = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
class JsonFileStore {
    basePath;
    cache = new Map();
    dirtyKeys = new Set();
    saveTimer = null;
    constructor(basePath) {
        this.basePath = basePath;
        if (!fs.existsSync(basePath)) {
            fs.mkdirSync(basePath, { recursive: true });
        }
    }
    static fromContext(context) {
        return new JsonFileStore(context.globalStorageUri.fsPath);
    }
    static fromWorkspace(workspacePath) {
        const justapiDir = path.join(workspacePath, '.local-api');
        return new JsonFileStore(justapiDir);
    }
    async read(key) {
        const filePath = path.join(this.basePath, `${key}.json`);
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(content);
                this.cache.set(key, data);
                return data;
            }
        }
        catch {
            // File might be corrupt, return null
        }
        return null;
    }
    async write(key, data) {
        this.cache.set(key, data);
        this.dirtyKeys.add(key);
        this.scheduleSave();
    }
    scheduleSave() {
        if (this.saveTimer)
            return;
        this.saveTimer = setTimeout(async () => {
            this.saveTimer = null;
            await this.flush();
        }, 500);
    }
    async flush() {
        for (const key of this.dirtyKeys) {
            const data = this.cache.get(key);
            if (data !== undefined) {
                const filePath = path.join(this.basePath, `${key}.json`);
                try {
                    const dir = path.dirname(filePath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
                }
                catch (err) {
                    console.error(`Failed to write ${filePath}:`, err);
                }
            }
        }
        this.dirtyKeys.clear();
    }
    getBasePath() {
        return this.basePath;
    }
    dispose() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.flush();
    }
}
exports.JsonFileStore = JsonFileStore;
//# sourceMappingURL=JsonFileStore.js.map