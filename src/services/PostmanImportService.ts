import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { parsePostmanExport, type ParsedPostmanImport } from '../engine/import/PostmanParser';
import type { PostmanImportPreview } from '../models/PostmanImport';
import { PROTOCOL_LIMITS } from '../protocol/MessageValidator';
import { VariableSetManager } from '../engine/variables/VariableSetManager';
import { CollectionService } from './CollectionService';
import { ApplicationError } from './ApplicationError';

interface Staged { path: string; digest: string; parsed: ParsedPostmanImport; preview: PostmanImportPreview; }
export class PostmanImportService {
  private readonly staged = new Map<string, Staged>();
  private readonly confirming = new Set<string>();
  private generation = 0;
  private previewSequence = 0;
  constructor(private readonly collections: CollectionService, private readonly sets: VariableSetManager,
    private readonly pickFile: () => Promise<string | undefined>) {}
  reset(): void { this.generation++; this.staged.clear(); }
  cancel(previewId: string): void { this.staged.delete(previewId); }
  async preview(): Promise<PostmanImportPreview | undefined> {
    const generation = this.generation; const sequence = ++this.previewSequence; const path = await this.pickFile();
    if (!path || generation !== this.generation || sequence !== this.previewSequence) { return; }
    const source = await this.read(path); const parsed = parsePostmanExport(source.content);
    if (generation !== this.generation || sequence !== this.previewSequence) { return; }
    // Keep at most one source document (and its credentials) in host memory.
    this.staged.clear();
    const preview = { ...parsed.preview, previewId: randomUUID(), fileName: basename(path).slice(0, 1024) };
    this.staged.set(preview.previewId, { path, digest: source.digest, parsed, preview }); return preview;
  }
  async confirm(previewId: string, name: string, acceptWarnings: boolean): Promise<void> {
    const entry = this.staged.get(previewId); const generation = this.generation;
    if (!entry || this.confirming.has(previewId) || !name.trim() || name.length > 1024
      || (entry.preview.diagnosticCount > 0 && !acceptWarnings)) {
      throw new ApplicationError('IMPORT_ERROR', ['Review the current preview and acknowledge its limitations before importing.']);
    }
    this.confirming.add(previewId);
    try {
      const source = await this.read(entry.path);
      if (generation !== this.generation || this.staged.get(previewId) !== entry || source.digest !== entry.digest) {
        throw new ApplicationError('IMPORT_ERROR', ['The file or preview changed. Choose the file again before importing.']);
      }
      if (entry.parsed.document) {
        const document = { ...entry.parsed.document, collection: { ...entry.parsed.document.collection, name: name.trim() } };
        await this.collections.importDocument(JSON.stringify(document), entry.parsed.authInputs);
      } else { await this.sets.create(name.trim(), 'environment', entry.parsed.environment!); }
      this.staged.delete(previewId);
    } finally { this.confirming.delete(previewId); }
  }
  private async read(path: string): Promise<{ content: string; digest: string }> {
    try {
      const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const stat = await file.stat(); const limit = PROTOCOL_LIMITS.importMessageBytes;
        if (!stat.isFile() || stat.size > limit) { throw new Error(); }
        const bytes = Buffer.alloc(limit + 1); let length = 0;
        while (length < bytes.length) {
          const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
          if (!bytesRead) { break; } length += bytesRead;
        }
        if (length > limit) { throw new Error(); }
        const data = bytes.subarray(0, length);
        return { content: new TextDecoder('utf-8', { fatal: true }).decode(data), digest: createHash('sha256').update(data).digest('hex') };
      } finally { await file.close(); }
    } catch { throw new ApplicationError('IMPORT_ERROR', ['Choose a readable local UTF-8 JSON file of at most 10 MiB.']); }
  }
}
