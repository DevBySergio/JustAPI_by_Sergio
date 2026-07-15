import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ExtensionStorageContext {
  globalStorageUri: { fsPath: string };
}

export const STORAGE_SCHEMA_VERSION = 2 as const;

export const STORAGE_LIMITS = {
  maximumDocumentBytes: 16 * 1024 * 1024,
  lockTimeoutMs: 5_000,
  staleLockMs: 30_000,
  maximumRuntimeBackups: 5,
} as const;

export interface StorageEnvelope<T> {
  schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  revision: number;
  updatedAt: number;
  data: T;
}

export type StorageFailureCode =
  | 'INVALID_KEY'
  | 'DOCUMENT_TOO_LARGE'
  | 'CORRUPT_DOCUMENT'
  | 'UNSUPPORTED_SCHEMA'
  | 'MIGRATION_FAILED'
  | 'LOCK_TIMEOUT'
  | 'STORAGE_CONFLICT'
  | 'COMMIT_FAILED'
  | 'RECOVERY_FAILED'
  | 'READ_ONLY'
  | 'STORE_DISPOSED';

export interface StorageFailure {
  code: StorageFailureCode;
  key: string;
  message: string;
  recovered: boolean;
  readOnly: boolean;
}

export interface StorageStatus {
  revision: number;
  readOnly: boolean;
  lastFailure?: StorageFailure;
}

export class StorageError extends Error {
  constructor(
    public readonly code: StorageFailureCode,
    public readonly key: string,
    message: string
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export interface JsonFileStoreOptions {
  maximumDocumentBytes?: number;
  lockTimeoutMs?: number;
  staleLockMs?: number;
  onFailure?: (failure: StorageFailure) => void;
  dataTransforms?: Record<string, (data: unknown) => unknown>;
  beforeRename?: (key: string, temporaryPath: string) => void | Promise<void>;
  now?: () => number;
}

interface LockRecord {
  pid: number;
  sessionId: string;
  token: string;
  acquiredAt: number;
}

type BackupStatus = 'created' | 'completed' | 'failed';

interface BackupJournalEntry {
  id: string;
  key: string;
  fileName: string;
  reason: 'migration' | 'commit';
  sourceSchemaVersion: 1 | 2;
  sourceRevision: number;
  createdAt: number;
  sha256: string;
  byteLength: number;
  redacted: boolean;
  status: BackupStatus;
}

interface MigrationJournal {
  version: 1;
  entries: BackupJournalEntry[];
}

type ParsedDocument =
  | { kind: 'absent' }
  | { kind: 'legacy'; data: unknown }
  | { kind: 'envelope'; envelope: StorageEnvelope<unknown> }
  | { kind: 'invalid'; code: 'DOCUMENT_TOO_LARGE' | 'CORRUPT_DOCUMENT' | 'UNSUPPORTED_SCHEMA' };

interface VerifiedBackup {
  entry: BackupJournalEntry;
  document: Extract<ParsedDocument, { kind: 'legacy' | 'envelope' }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBackupJournalEntry(value: unknown): value is BackupJournalEntry {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.key === 'string'
    && typeof value.fileName === 'string'
    && path.basename(value.fileName) === value.fileName
    && (value.reason === 'migration' || value.reason === 'commit')
    && (value.sourceSchemaVersion === 1 || value.sourceSchemaVersion === 2)
    && typeof value.sourceRevision === 'number'
    && Number.isInteger(value.sourceRevision)
    && value.sourceRevision >= 0
    && typeof value.createdAt === 'number'
    && Number.isFinite(value.createdAt)
    && typeof value.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(value.sha256)
    && typeof value.byteLength === 'number'
    && Number.isInteger(value.byteLength)
    && value.byteLength >= 0
    && typeof value.redacted === 'boolean'
    && (value.status === 'created' || value.status === 'completed' || value.status === 'failed');
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class JsonFileStore {
  private readonly cache = new Map<string, unknown>();
  private readonly knownRevisions = new Map<string, number>();
  private readonly readOnlyKeys = new Set<string>();
  private readonly lastFailures = new Map<string, StorageFailure>();
  private readonly sessionId = randomUUID();
  private operationQueue: Promise<void> = Promise.resolve();
  private disposePromise: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly basePath: string,
    private readonly options: JsonFileStoreOptions = {}
  ) {
    fs.mkdirSync(basePath, { recursive: true });
  }

  static fromContext(
    context: ExtensionStorageContext,
    options?: JsonFileStoreOptions
  ): JsonFileStore {
    return new JsonFileStore(context.globalStorageUri.fsPath, options);
  }

  static fromWorkspace(workspacePath: string, options?: JsonFileStoreOptions): JsonFileStore {
    return new JsonFileStore(path.join(workspacePath, '.local-api'), options);
  }

  async read<T>(key: string): Promise<T | null> {
    this.assertAvailable(key);
    return this.enqueue(async () => await this.readInternal<T>(key));
  }

  async write<T>(key: string, data: T): Promise<void> {
    this.assertAvailable(key);
    await this.enqueue(async () => {
      await this.writeInternal(key, data);
    });
  }

  async flush(): Promise<void> {
    await this.operationQueue;
  }

  getBasePath(): string {
    return this.basePath;
  }

  getStatus(key: string): StorageStatus {
    this.assertKey(key);
    const lastFailure = this.lastFailures.get(key);
    return {
      revision: this.knownRevisions.get(key) ?? 0,
      readOnly: this.readOnlyKeys.has(key),
      ...(lastFailure ? { lastFailure } : {}),
    };
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) {
      await this.disposePromise;
      return;
    }
    this.disposed = true;
    this.disposePromise = this.operationQueue;
    await this.disposePromise;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private assertAvailable(key: string): void {
    this.assertKey(key);
    if (this.disposed) {
      throw new StorageError('STORE_DISPOSED', key, 'The storage service has been disposed.');
    }
  }

  private assertKey(key: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key)) {
      throw new StorageError('INVALID_KEY', key, 'Storage keys must be simple file-safe identifiers.');
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readInternal<T>(key: string): Promise<T | null> {
    return await this.withLock(key, async () => {
      const filePath = this.filePath(key);
      const current = await this.readDocument(filePath);
      if (current.kind === 'absent') {
        this.cache.delete(key);
        this.knownRevisions.set(key, 0);
        return null;
      }
      if (current.kind === 'invalid') {
        const recovered = await this.recoverInvalidLocked(key, current);
        return recovered ? recovered.envelope.data as T : null;
      }
      if (current.kind === 'legacy') {
        try {
          const migrated = await this.migrateLegacyLocked(key, current.data);
          return migrated.data as T;
        } catch {
          const recovered = await this.recoverInvalidLocked(
            key,
            { kind: 'invalid', code: 'CORRUPT_DOCUMENT' },
            'MIGRATION_FAILED'
          );
          return recovered ? recovered.envelope.data as T : null;
        }
      }

      let transformedData: unknown;
      try {
        transformedData = this.transformData(key, current.envelope.data);
      } catch {
        const recovered = await this.recoverInvalidLocked(
          key,
          { kind: 'invalid', code: 'CORRUPT_DOCUMENT' },
          'MIGRATION_FAILED'
        );
        return recovered ? recovered.envelope.data as T : null;
      }

      try {
        if (!this.sameData(transformedData, current.envelope.data)) {
          const nextEnvelope: StorageEnvelope<unknown> = {
            schemaVersion: STORAGE_SCHEMA_VERSION,
            revision: current.envelope.revision + 1,
            updatedAt: this.now(),
            data: transformedData,
          };
          this.serializeDocument(nextEnvelope, key);
          const backup = await this.createBackup(
            key,
            {
              ...current.envelope,
              data: transformedData,
            },
            'commit',
            true
          );
          await this.atomicWriteEnvelope(key, nextEnvelope);
          await this.completeBackup(key, backup.id);
          this.rememberEnvelope(key, nextEnvelope);
          return nextEnvelope.data as T;
        }
        this.rememberEnvelope(key, current.envelope);
        return current.envelope.data as T;
      } catch {
        const primary = await this.readDocument(this.filePath(key));
        if (primary.kind === 'invalid') {
          const recovered = await this.recoverInvalidLocked(key, primary, 'MIGRATION_FAILED');
          return recovered ? recovered.envelope.data as T : null;
        }
        this.enterReadOnly(key, 'MIGRATION_FAILED', 'The transformed storage data could not be committed.');
        return null;
      }
    });
  }

  private async writeInternal<T>(key: string, data: T): Promise<void> {
    await this.withLock(key, async () => {
      if (this.readOnlyKeys.has(key)) {
        throw new StorageError('READ_ONLY', key, 'Storage is read-only until recovery or reload.');
      }

      let current = await this.readDocument(this.filePath(key));
      if (current.kind === 'invalid') {
        const recovered = await this.recoverInvalidLocked(key, current);
        if (!recovered) {
          throw new StorageError('READ_ONLY', key, 'Storage recovery is required before writing.');
        }
        current = recovered;
      }
      if (current.kind === 'legacy') {
        const migrated = await this.migrateLegacyLocked(key, current.data);
        current = { kind: 'envelope', envelope: migrated };
      }

      const currentRevision = current.kind === 'envelope' ? current.envelope.revision : 0;
      const expectedRevision = this.knownRevisions.get(key);
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        this.enterReadOnly(
          key,
          'STORAGE_CONFLICT',
          `Storage revision changed from ${expectedRevision} to ${currentRevision} in another window.`
        );
        throw new StorageError(
          'STORAGE_CONFLICT',
          key,
          `Expected revision ${expectedRevision}, found ${currentRevision}.`
        );
      }

      let transformedData: unknown;
      try {
        transformedData = this.transformData(key, data);
      } catch {
        throw new StorageError('MIGRATION_FAILED', key, 'The storage payload failed domain validation.');
      }

      const nextEnvelope: StorageEnvelope<unknown> = {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        revision: currentRevision + 1,
        updatedAt: this.now(),
        data: transformedData,
      };
      this.serializeDocument(nextEnvelope, key);

      let backup: BackupJournalEntry | null = null;
      if (current.kind === 'envelope') {
        const safeData = this.transformData(key, current.envelope.data);
        const safeCurrent: StorageEnvelope<unknown> = {
          ...current.envelope,
          data: safeData,
        };
        backup = await this.createBackup(
          key,
          safeCurrent,
          'commit',
          !this.sameData(safeData, current.envelope.data)
        );
      }

      try {
        await this.atomicWriteEnvelope(key, nextEnvelope);
        if (backup) {
          await this.completeBackup(key, backup.id);
        }
        this.rememberEnvelope(key, nextEnvelope);
        this.lastFailures.delete(key);
      } catch (error) {
        const primary = await this.readDocument(this.filePath(key));
        if (primary.kind === 'invalid') {
          await this.recoverInvalidLocked(key, primary, 'COMMIT_FAILED');
        }
        this.reportFailure({
          code: 'COMMIT_FAILED',
          key,
          message: 'The write failed before it could be acknowledged.',
          recovered: false,
          readOnly: this.readOnlyKeys.has(key),
        });
        if (error instanceof StorageError) {
          throw error;
        }
        throw new StorageError('COMMIT_FAILED', key, 'The write could not be committed.');
      }
    });
  }

  private async migrateLegacyLocked(
    key: string,
    legacyData: unknown
  ): Promise<StorageEnvelope<unknown>> {
    let transformedData: unknown;
    try {
      transformedData = this.transformData(key, legacyData);
    } catch {
      throw new StorageError('MIGRATION_FAILED', key, 'Legacy data failed domain validation.');
    }

    const redacted = !this.sameData(transformedData, legacyData);
    const backup = await this.createBackup(key, transformedData, 'migration', redacted);
    const envelope: StorageEnvelope<unknown> = {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      revision: 1,
      updatedAt: this.now(),
      data: transformedData,
    };
    this.serializeDocument(envelope, key);
    try {
      await this.atomicWriteEnvelope(key, envelope);
      await this.completeBackup(key, backup.id);
      this.rememberEnvelope(key, envelope);
      return envelope;
    } catch (error) {
      await this.updateBackupStatus(backup.id, 'failed').catch(() => undefined);
      throw error;
    }
  }

  private rememberEnvelope(key: string, envelope: StorageEnvelope<unknown>): void {
    this.cache.set(key, envelope.data);
    this.knownRevisions.set(key, envelope.revision);
  }

  private transformData(key: string, data: unknown): unknown {
    return this.options.dataTransforms?.[key]?.(data) ?? data;
  }

  private sameData(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private filePath(key: string): string {
    return path.join(this.basePath, `${key}.json`);
  }

  private async readDocument(filePath: string): Promise<ParsedDocument> {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > (this.options.maximumDocumentBytes ?? STORAGE_LIMITS.maximumDocumentBytes)) {
        return { kind: 'invalid', code: 'DOCUMENT_TOO_LARGE' };
      }
      const serialized = await fs.promises.readFile(filePath, 'utf8');
      if (Buffer.byteLength(serialized, 'utf8')
        > (this.options.maximumDocumentBytes ?? STORAGE_LIMITS.maximumDocumentBytes)) {
        return { kind: 'invalid', code: 'DOCUMENT_TOO_LARGE' };
      }
      const parsed = JSON.parse(serialized) as unknown;
      const looksLikeEnvelope = isRecord(parsed)
        && Object.prototype.hasOwnProperty.call(parsed, 'schemaVersion')
        && ['revision', 'updatedAt', 'data'].some(key => Object.prototype.hasOwnProperty.call(parsed, key));
      if (looksLikeEnvelope) {
        if (parsed.schemaVersion !== STORAGE_SCHEMA_VERSION) {
          return { kind: 'invalid', code: 'UNSUPPORTED_SCHEMA' };
        }
        if (!Number.isInteger(parsed.revision)
          || (parsed.revision as number) < 1
          || typeof parsed.updatedAt !== 'number'
          || !Number.isFinite(parsed.updatedAt)
          || parsed.updatedAt < 0
          || !Object.prototype.hasOwnProperty.call(parsed, 'data')) {
          return { kind: 'invalid', code: 'CORRUPT_DOCUMENT' };
        }
        return {
          kind: 'envelope',
          envelope: parsed as unknown as StorageEnvelope<unknown>,
        };
      }
      return { kind: 'legacy', data: parsed };
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { kind: 'absent' };
      }
      return { kind: 'invalid', code: 'CORRUPT_DOCUMENT' };
    }
  }

  private serializeDocument(document: unknown, key: string): string {
    let serialized: string;
    try {
      serialized = `${JSON.stringify(document, null, 2)}\n`;
    } catch {
      throw new StorageError('COMMIT_FAILED', key, 'The storage payload is not serializable.');
    }
    if (Buffer.byteLength(serialized, 'utf8')
      > (this.options.maximumDocumentBytes ?? STORAGE_LIMITS.maximumDocumentBytes)) {
      throw new StorageError('DOCUMENT_TOO_LARGE', key, 'The storage payload exceeds the configured limit.');
    }
    return serialized;
  }

  private async atomicWriteEnvelope(key: string, envelope: StorageEnvelope<unknown>): Promise<void> {
    const filePath = this.filePath(key);
    const temporaryPath = path.join(
      this.basePath,
      `.${key}.tmp-${process.pid}-${randomUUID()}`
    );
    const serialized = this.serializeDocument(envelope, key);
    let handle: fs.promises.FileHandle | null = null;
    try {
      handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await this.options.beforeRename?.(key, temporaryPath);
      await fs.promises.rename(temporaryPath, filePath);
      await this.syncDirectory();
      const verified = await this.readDocument(filePath);
      if (verified.kind !== 'envelope'
        || verified.envelope.revision !== envelope.revision
        || verified.envelope.updatedAt !== envelope.updatedAt
        || !this.sameData(verified.envelope.data, envelope.data)) {
        throw new StorageError('COMMIT_FAILED', key, 'Committed storage failed verification.');
      }
    } finally {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      await fs.promises.unlink(temporaryPath).catch(() => undefined);
    }
  }

  private async syncDirectory(): Promise<void> {
    let directoryHandle: fs.promises.FileHandle | null = null;
    try {
      directoryHandle = await fs.promises.open(this.basePath, fs.constants.O_RDONLY);
      await directoryHandle.sync();
    } catch {
      // Some platforms do not support fsync on a directory.
    } finally {
      await directoryHandle?.close().catch(() => undefined);
    }
  }

  private async createBackup(
    key: string,
    document: unknown,
    reason: BackupJournalEntry['reason'],
    redacted: boolean
  ): Promise<BackupJournalEntry> {
    const backupDirectory = path.join(this.basePath, 'backups');
    await fs.promises.mkdir(backupDirectory, { recursive: true });
    const sourceSchemaVersion = isRecord(document)
      && document.schemaVersion === STORAGE_SCHEMA_VERSION ? 2 : 1;
    const sourceRevision = sourceSchemaVersion === 2
      ? Number((document as unknown as StorageEnvelope<unknown>).revision)
      : 0;
    const id = randomUUID();
    const fileName = sourceSchemaVersion === 1
      ? `${key}.v1.${this.now()}.${id}.json`
      : `${key}.v2.r${sourceRevision}.${this.now()}.${id}.json`;
    const backupPath = path.join(backupDirectory, fileName);
    const serialized = this.serializeDocument(document, key);
    const sha256 = createHash('sha256').update(serialized).digest('hex');
    let handle: fs.promises.FileHandle | null = null;
    try {
      handle = await fs.promises.open(backupPath, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      const verified = await fs.promises.readFile(backupPath, 'utf8');
      const parsed = await this.readDocument(backupPath);
      if (verified !== serialized
        || createHash('sha256').update(verified).digest('hex') !== sha256
        || (parsed.kind !== 'legacy' && parsed.kind !== 'envelope')) {
        throw new StorageError('RECOVERY_FAILED', key, 'The new backup failed verification.');
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fs.promises.unlink(backupPath).catch(() => undefined);
      throw error;
    }

    const entry: BackupJournalEntry = {
      id,
      key,
      fileName,
      reason,
      sourceSchemaVersion,
      sourceRevision,
      createdAt: this.now(),
      sha256,
      byteLength: Buffer.byteLength(serialized, 'utf8'),
      redacted,
      status: 'created',
    };
    try {
      const journal = await this.readJournal();
      journal.entries.push(entry);
      await this.writeJournal(journal);
      if (reason === 'commit') {
        await this.pruneRuntimeBackups(key, journal);
      }
      return entry;
    } catch (error) {
      await fs.promises.unlink(backupPath).catch(() => undefined);
      throw error;
    }
  }

  private async readJournal(): Promise<MigrationJournal> {
    const journalPath = path.join(this.basePath, 'migration-journal.json');
    try {
      const parsed = JSON.parse(await fs.promises.readFile(journalPath, 'utf8')) as unknown;
      if (!isRecord(parsed)
        || parsed.version !== 1
        || !Array.isArray(parsed.entries)
        || !parsed.entries.every(isBackupJournalEntry)) {
        throw new Error('Invalid migration journal.');
      }
      return parsed as unknown as MigrationJournal;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { version: 1, entries: [] };
      }
      throw new StorageError('RECOVERY_FAILED', 'migration-journal', 'The migration journal is corrupt.');
    }
  }

  private async writeJournal(journal: MigrationJournal): Promise<void> {
    const journalPath = path.join(this.basePath, 'migration-journal.json');
    const temporaryPath = path.join(this.basePath, `.migration-journal.tmp-${randomUUID()}`);
    const serialized = this.serializeDocument(journal, 'migration-journal');
    let handle: fs.promises.FileHandle | null = null;
    try {
      handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.promises.rename(temporaryPath, journalPath);
      await this.syncDirectory();
    } finally {
      await handle?.close().catch(() => undefined);
      await fs.promises.unlink(temporaryPath).catch(() => undefined);
    }
  }

  private async updateBackupStatus(id: string, status: BackupStatus): Promise<void> {
    const journal = await this.readJournal();
    const entry = journal.entries.find(candidate => candidate.id === id);
    if (!entry) {
      throw new StorageError('RECOVERY_FAILED', 'migration-journal', 'A backup journal entry is missing.');
    }
    entry.status = status;
    await this.writeJournal(journal);
  }

  private async completeBackup(key: string, id: string): Promise<void> {
    try {
      await this.updateBackupStatus(id, 'completed');
    } catch {
      this.reportFailure({
        code: 'RECOVERY_FAILED',
        key,
        message: 'Data was committed, but its backup journal status could not be finalized.',
        recovered: false,
        readOnly: false,
      });
    }
  }

  private async pruneRuntimeBackups(key: string, journal: MigrationJournal): Promise<void> {
    const runtime = journal.entries
      .filter(entry => entry.key === key && entry.reason === 'commit')
      .sort((left, right) => right.createdAt - left.createdAt);
    const obsolete = runtime.slice(STORAGE_LIMITS.maximumRuntimeBackups);
    if (obsolete.length === 0) {
      return;
    }
    for (const entry of obsolete) {
      await fs.promises.unlink(path.join(this.basePath, 'backups', entry.fileName)).catch(() => undefined);
    }
    const obsoleteIds = new Set(obsolete.map(entry => entry.id));
    journal.entries = journal.entries.filter(entry => !obsoleteIds.has(entry.id));
    await this.writeJournal(journal);
  }

  private async recoverInvalidLocked(
    key: string,
    invalid: Extract<ParsedDocument, { kind: 'invalid' }>,
    overrideCode?: StorageFailureCode
  ): Promise<Extract<ParsedDocument, { kind: 'envelope' }> | null> {
    const failureCode = overrideCode ?? invalid.code;
    if (invalid.code === 'UNSUPPORTED_SCHEMA') {
      this.enterReadOnly(
        key,
        'UNSUPPORTED_SCHEMA',
        'This data was written by a newer unsupported storage schema.'
      );
      return null;
    }

    let backup: VerifiedBackup | null = null;
    try {
      backup = await this.findNewestVerifiedBackup(key);
    } catch {
      backup = null;
    }
    if (!backup) {
      this.enterReadOnly(
        key,
        failureCode,
        'Storage is invalid and no verified backup is available; the original file was preserved.'
      );
      return null;
    }

    const quarantinePath = await this.quarantinePrimary(key);
    try {
      const rawData = backup.document.kind === 'envelope'
        ? backup.document.envelope.data
        : backup.document.data;
      const envelope: StorageEnvelope<unknown> = {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        revision: backup.document.kind === 'envelope'
          ? backup.document.envelope.revision
          : 1,
        updatedAt: this.now(),
        data: this.transformData(key, rawData),
      };
      await this.atomicWriteEnvelope(key, envelope);
      this.readOnlyKeys.delete(key);
      this.rememberEnvelope(key, envelope);
      this.reportFailure({
        code: failureCode,
        key,
        message: `Recovered storage from verified backup ${backup.entry.fileName}.`,
        recovered: true,
        readOnly: false,
      });
      return { kind: 'envelope', envelope };
    } catch {
      if (quarantinePath) {
        const primary = this.filePath(key);
        const current = await this.readDocument(primary);
        if (current.kind === 'absent') {
          await fs.promises.rename(quarantinePath, primary).catch(() => undefined);
        }
      }
      this.enterReadOnly(key, 'RECOVERY_FAILED', 'Verified backup recovery failed.');
      return null;
    }
  }

  private async findNewestVerifiedBackup(key: string): Promise<VerifiedBackup | null> {
    const journal = await this.readJournal();
    const candidates = journal.entries
      .filter(entry => entry.key === key)
      .sort((left, right) => right.createdAt - left.createdAt);
    for (const entry of candidates) {
      const backupPath = path.join(this.basePath, 'backups', path.basename(entry.fileName));
      try {
        const serialized = await fs.promises.readFile(backupPath, 'utf8');
        if (Buffer.byteLength(serialized, 'utf8') !== entry.byteLength
          || createHash('sha256').update(serialized).digest('hex') !== entry.sha256) {
          continue;
        }
        const document = await this.readDocument(backupPath);
        if (document.kind === 'legacy' || document.kind === 'envelope') {
          return { entry, document };
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private async quarantinePrimary(key: string): Promise<string | null> {
    const primary = this.filePath(key);
    try {
      const quarantineDirectory = path.join(this.basePath, 'quarantine');
      await fs.promises.mkdir(quarantineDirectory, { recursive: true });
      const sha256 = await this.hashFile(primary);
      const quarantinePath = path.join(
        quarantineDirectory,
        `${key}.corrupt.${this.now()}.${sha256.slice(0, 16)}.json`
      );
      await fs.promises.rename(primary, quarantinePath);
      return quarantinePath;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async hashFile(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const handle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    try {
      let position = 0;
      while (true) {
        const result = await handle.read(buffer, 0, buffer.length, position);
        if (result.bytesRead === 0) {
          break;
        }
        hash.update(buffer.subarray(0, result.bytesRead));
        position += result.bytesRead;
      }
      return hash.digest('hex');
    } finally {
      await handle.close();
    }
  }

  private enterReadOnly(key: string, code: StorageFailureCode, message: string): void {
    this.readOnlyKeys.add(key);
    this.reportFailure({ code, key, message, recovered: false, readOnly: true });
  }

  private reportFailure(failure: StorageFailure): void {
    this.lastFailures.set(failure.key, failure);
    this.options.onFailure?.(failure);
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const lock = await this.acquireLock(key);
    try {
      return await operation();
    } finally {
      await this.releaseLock(lock);
    }
  }

  private async acquireLock(key: string): Promise<LockRecord> {
    const lockPath = path.join(this.basePath, '.storage.lock');
    const timeout = this.options.lockTimeoutMs ?? STORAGE_LIMITS.lockTimeoutMs;
    const deadline = Date.now() + timeout;
    while (true) {
      const lock: LockRecord = {
        pid: process.pid,
        sessionId: this.sessionId,
        token: randomUUID(),
        acquiredAt: this.now(),
      };
      let handle: fs.promises.FileHandle | null = null;
      let ownsLock = false;
      try {
        handle = await fs.promises.open(lockPath, 'wx', 0o600);
        ownsLock = true;
        await handle.writeFile(`${JSON.stringify(lock)}\n`, 'utf8');
        await handle.sync();
        await handle.close();
        return lock;
      } catch (error) {
        await handle?.close().catch(() => undefined);
        if (ownsLock) {
          await fs.promises.unlink(lockPath).catch(() => undefined);
        }
        if (!isNodeError(error) || error.code !== 'EEXIST') {
          throw new StorageError('LOCK_TIMEOUT', key, 'The storage lock could not be acquired.');
        }
        await this.reclaimStaleLock(lockPath);
        if (Date.now() >= deadline) {
          this.reportFailure({
            code: 'LOCK_TIMEOUT',
            key,
            message: 'Another JustAPI window is holding the storage lock.',
            recovered: false,
            readOnly: false,
          });
          throw new StorageError('LOCK_TIMEOUT', key, 'Timed out waiting for the storage lock.');
        }
        await delay(20 + Math.floor(Math.random() * 30));
      }
    }
  }

  private async reclaimStaleLock(lockPath: string): Promise<void> {
    try {
      const stat = await fs.promises.stat(lockPath);
      if (Date.now() - stat.mtimeMs < (this.options.staleLockMs ?? STORAGE_LIMITS.staleLockMs)) {
        return;
      }
      const candidate = JSON.parse(await fs.promises.readFile(lockPath, 'utf8')) as unknown;
      if (!isRecord(candidate) || !Number.isInteger(candidate.pid)) {
        return;
      }
      const pid = candidate.pid as number;
      if (this.isProcessAlive(pid)) {
        return;
      }
      await fs.promises.unlink(lockPath);
    } catch {
      // The owner may have released or replaced the lock while it was inspected.
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return !(isNodeError(error) && error.code === 'ESRCH');
    }
  }

  private async releaseLock(lock: LockRecord): Promise<void> {
    const lockPath = path.join(this.basePath, '.storage.lock');
    try {
      const current = JSON.parse(await fs.promises.readFile(lockPath, 'utf8')) as unknown;
      if (isRecord(current) && current.token === lock.token) {
        await fs.promises.unlink(lockPath);
      }
    } catch {
      // A missing or replaced lock must never be removed blindly.
    }
  }
}
