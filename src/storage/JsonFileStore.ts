import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export class JsonFileStore {
  private basePath: string;
  private cache: Map<string, unknown> = new Map();
  private dirtyKeys: Set<string> = new Set();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }
  }

  static fromContext(context: vscode.ExtensionContext): JsonFileStore {
    return new JsonFileStore(context.globalStorageUri.fsPath);
  }

  static fromWorkspace(workspacePath: string): JsonFileStore {
    const justapiDir = path.join(workspacePath, '.local-api');
    return new JsonFileStore(justapiDir);
  }

  async read<T>(key: string): Promise<T | null> {
    const filePath = path.join(this.basePath, `${key}.json`);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content) as T;
        this.cache.set(key, data);
        return data;
      }
    } catch {
      // File might be corrupt, return null
    }
    return null;
  }

  async write<T>(key: string, data: T): Promise<void> {
    this.cache.set(key, data);
    this.dirtyKeys.add(key);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      await this.flush();
    }, 500);
  }

  async flush(): Promise<void> {
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
        } catch (err) {
          console.error(`Failed to write ${filePath}:`, err);
        }
      }
    }
    this.dirtyKeys.clear();
  }

  getBasePath(): string {
    return this.basePath;
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.flush();
  }
}
