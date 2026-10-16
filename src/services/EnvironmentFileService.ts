import { createHash, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants, watchFile, unwatchFile } from 'node:fs';
import { basename } from 'node:path';
import { parseEnv } from '../engine/variables/EnvParser';
import { VariableSetManager } from '../engine/variables/VariableSetManager';
import { ENV_FILE_LIMITS, type EnvImportPreview, type EnvWatch } from '../models/Environment';
import { ApplicationError } from './ApplicationError';

interface Staged { preview: EnvImportPreview; path: string; digest: string; revision?: number; }
interface Watch { path: string; digest: string; dispose: () => void; generation: number; }
export type EnvWatchFactory = (path: string, changed: () => void) => () => void;
const defaultWatch: EnvWatchFactory = (path, changed) => {
  watchFile(path, { interval: 1000, persistent: false }, changed);
  return () => unwatchFile(path, changed);
};

export class EnvironmentFileService {
  private previews = new Map<string, Staged>();
  private watches = new Map<string, Watch>();
  private generation = 0;
  private confirming = new Set<string>();
  constructor(
    private readonly sets: VariableSetManager,
    private readonly pickFile: () => Promise<string | undefined>,
    private readonly emitPreview: (preview: EnvImportPreview) => void,
    private readonly emitError: () => void,
    private readonly createWatch: EnvWatchFactory = defaultWatch
  ) {}

  getWatches(): EnvWatch[] { return [...this.watches].map(([setId, entry]) => ({ setId, fileName: basename(entry.path) })); }
  reset(): void { this.generation++; this.previews.clear(); for (const id of [...this.watches.keys()]) { this.stop(id); } }
  stop(setId: string): void {
    this.watches.get(setId)?.dispose(); this.watches.delete(setId);
    for (const [id, entry] of this.previews) { if (entry.preview.targetSetId === setId) { this.previews.delete(id); } }
  }
  cancel(previewId: string): void { this.previews.delete(previewId); }

  async preview(targetSetId?: string): Promise<EnvImportPreview | undefined> {
    const generation = this.generation;
    const path = await this.pickFile();
    if (!path || generation !== this.generation) { return; }
    const staged = await this.stage(path, targetSetId);
    if (generation !== this.generation) { return; }
    this.remember(staged); return staged.preview;
  }

  async confirm(previewId: string, name: string, watch: boolean): Promise<void> {
    if (this.confirming.has(previewId)) { throw new ApplicationError('IMPORT_ERROR', ['This preview is already being imported.']); }
    this.confirming.add(previewId);
    try { await this.applyPreview(previewId, name, watch); } finally { this.confirming.delete(previewId); }
  }

  private async applyPreview(previewId: string, name: string, watch: boolean): Promise<void> {
    const staged = this.previews.get(previewId); const generation = this.generation;
    if (!staged || staged.preview.diagnostics.length || !name.trim()) {
      throw new ApplicationError('IMPORT_ERROR', ['Choose a valid environment preview before importing.']);
    }
    const current = await this.read(staged.path);
    if (generation !== this.generation || current.digest !== staged.digest || this.previews.get(previewId) !== staged) {
      throw new ApplicationError('IMPORT_ERROR', ['The file or preview changed. Preview it again before importing.']);
    }
    let setId = staged.preview.targetSetId;
    if (setId) {
      const set = this.sets.getById(setId);
      if (set?.kind !== 'environment' || set.updated !== staged.revision) {
        throw new ApplicationError('IMPORT_ERROR', ['The environment changed. Preview the file again before replacing its variables.']);
      }
      await this.sets.update({ ...set, name: name.trim(), variables: staged.preview.variables });
    } else { setId = (await this.sets.create(name.trim(), 'environment', staged.preview.variables)).id; }
    this.previews.delete(previewId);
    this.stop(setId);
    if (watch && generation === this.generation) {
      const entry: Watch = { path: staged.path, digest: staged.digest, dispose: () => undefined, generation: 0 };
      try {
        entry.dispose = this.createWatch(staged.path, () => { void this.changed(setId!, entry); });
        this.watches.set(setId, entry);
        // Close the gap between the confirmed read and installing the watcher.
        void this.changed(setId, entry);
      } catch { this.emitError(); }
    }
  }

  private async changed(setId: string, entry: Watch): Promise<void> {
    if (this.watches.get(setId) !== entry) { return; }
    const revision = ++entry.generation;
    try {
      const staged = await this.stage(entry.path, setId);
      if (this.watches.get(setId) !== entry || entry.generation !== revision || staged.digest === entry.digest) { return; }
      entry.digest = staged.digest;
      for (const [id, previous] of this.previews) { if (previous.preview.targetSetId === setId) { this.previews.delete(id); } }
      this.remember(staged); this.emitPreview(staged.preview);
    } catch { if (this.watches.get(setId) === entry && entry.generation === revision) { this.emitError(); } }
  }

  private remember(staged: Staged): void {
    while (this.previews.size >= 20) { this.previews.delete(this.previews.keys().next().value!); }
    this.previews.set(staged.preview.previewId, staged);
  }
  private async stage(path: string, targetSetId?: string): Promise<Staged> {
    const set = targetSetId ? this.sets.getById(targetSetId) : undefined;
    if (targetSetId && set?.kind !== 'environment') { throw new ApplicationError('IMPORT_ERROR', ['Environment not found.']); }
    const source = await this.read(path);
    return { path, digest: source.digest, revision: set?.updated, preview: { previewId: randomUUID(), fileName: basename(path).slice(0, 1024),
      ...parseEnv(source.content), ...(targetSetId ? { targetSetId } : {}) } };
  }
  private async read(path: string): Promise<{ content: string; digest: string }> {
    try {
      const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > ENV_FILE_LIMITS.bytes) { throw new Error(); }
        const buffer = Buffer.alloc(ENV_FILE_LIMITS.bytes + 1); let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
          if (!bytesRead) { break; } length += bytesRead;
        }
        if (length > ENV_FILE_LIMITS.bytes) { throw new Error(); }
        const data = buffer.subarray(0, length);
        return { content: new TextDecoder('utf-8', { fatal: true }).decode(data), digest: createHash('sha256').update(data).digest('hex') };
      } finally { await file.close(); }
    } catch { throw new ApplicationError('IMPORT_ERROR', ['The selected environment file must be a readable UTF-8 regular file of at most 1 MiB.']); }
  }
}
