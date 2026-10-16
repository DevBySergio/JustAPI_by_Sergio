import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { JustRequest } from '../models/Request';
import { FILE_UPLOAD_LIMITS, type RequestFile } from '../models/RequestFile';
import type { VariableDiagnostic } from '../models/VariableResolution';
import { ApplicationError } from './ApplicationError';

interface Selection { requestId: string; path: string; file: RequestFile; fingerprint: string; digest: string; }
const fingerprint = (value: Awaited<ReturnType<typeof stat>>) => `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`;
export function activeRequestFiles(request: JustRequest): Array<{ file?: RequestFile; location: string }> {
  if (request.body.type === 'binary' && request.body.binarySource === 'file') { return [{ file: request.body.file, location: 'body.file' }]; }
  return request.body.type === 'form-data' ? (request.body.files ?? []).flatMap((field, index) => field.enabled && field.key ? [{ file: field.file, location: `body.files[${index}]` }] : []) : [];
}
export function withoutRequestFiles(request: JustRequest): JustRequest {
  const copy = JSON.parse(JSON.stringify(request)) as JustRequest;
  delete copy.body.file;
  copy.body.files?.forEach(field => { delete field.file; }); return copy;
}

export class RequestFileService {
  private readonly selections = new Map<string, Selection>();
  private readonly pending = new Map<string, number>();
  private generation = 0;
  private sequence = 0;
  constructor(private readonly pickFile: () => Promise<string | undefined>) {}
  reset(): void { this.generation++; this.selections.clear(); this.pending.clear(); }
  releaseRequest(requestId: string): void {
    for (const [id, selection] of this.selections) { if (selection.requestId === requestId) { this.selections.delete(id); } }
    for (const key of this.pending.keys()) { if (JSON.parse(key)[0] === requestId) { this.pending.delete(key); } }
  }
  forEditor(request: JustRequest): JustRequest {
    const copy = JSON.parse(JSON.stringify(request)) as JustRequest;
    if (copy.body.file && !this.match(request.id, copy.body.file)) { delete copy.body.file; }
    copy.body.files?.forEach(field => { if (field.file && !this.match(request.id, field.file)) { delete field.file; } }); return copy;
  }
  async select(requestId: string, fieldId?: string): Promise<RequestFile | undefined> {
    const generation = this.generation; const key = JSON.stringify([requestId, fieldId ?? 'binary']); const revision = ++this.sequence;
    this.pending.set(key, revision);
    try {
      const selected = await this.pickFile();
      if (!selected || generation !== this.generation || this.pending.get(key) !== revision) { return; }
      if (this.selections.size >= FILE_UPLOAD_LIMITS.maximumSelections) { throw new ApplicationError('OPERATION_FAILED', ['Close request tabs before selecting more files.']); }
      const path = await realpath(selected).catch(() => { throw this.unavailable(); });
      const snapshot = await this.read(path);
      if (generation !== this.generation || this.pending.get(key) !== revision) { return; }
      const file: RequestFile = { id: randomUUID(), name: basename(path).replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 255) || 'upload.bin', size: snapshot.bytes.length, lastModified: Math.max(0, Math.floor(snapshot.modified)) };
      this.selections.set(file.id, { requestId, path, file, fingerprint: snapshot.fingerprint, digest: snapshot.digest }); return { ...file };
    } finally { if (this.pending.get(key) === revision) { this.pending.delete(key); } }
  }
  async validate(request: JustRequest): Promise<VariableDiagnostic[]> {
    const diagnostics: VariableDiagnostic[] = [];
    for (const { file, location } of activeRequestFiles(request)) {
      const selection = file && this.match(request.id, file);
      if (!selection) { diagnostics.push({ code: 'FILE_NOT_SELECTED', location }); continue; }
      try {
        const current = await stat(selection.path);
        if (!current.isFile() || fingerprint(current) !== selection.fingerprint) { diagnostics.push({ code: 'FILE_CHANGED', location }); }
      } catch { diagnostics.push({ code: 'FILE_UNAVAILABLE', location }); }
    }
    return diagnostics;
  }
  async bytes(requestId: string, file: RequestFile): Promise<Buffer> {
    const selection = this.match(requestId, file); const generation = this.generation;
    if (!selection) { throw this.unavailable(); }
    const current = await this.read(selection.path);
    if (generation !== this.generation || this.selections.get(file.id) !== selection || current.fingerprint !== selection.fingerprint || current.digest !== selection.digest) {
      throw new ApplicationError('REQUEST_VALIDATION_FAILED', ['The selected file changed or its selection expired. Select it again before sending.']);
    }
    return current.bytes;
  }
  private match(requestId: string, file: RequestFile): Selection | undefined {
    const entry = this.selections.get(file.id);
    return entry && entry.requestId === requestId && entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified ? entry : undefined;
  }
  private unavailable(): ApplicationError { return new ApplicationError('REQUEST_VALIDATION_FAILED', ['Select a readable local file again before sending.']); }
  private async read(path: string): Promise<{ bytes: Buffer; modified: number; fingerprint: string; digest: string }> {
    try {
      const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = await handle.stat(); const maximum = FILE_UPLOAD_LIMITS.maximumFileBytes;
        if (!before.isFile() || before.size > maximum) { throw new Error(); }
        const buffer = Buffer.alloc(maximum + 1); let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
          if (!bytesRead) { break; } length += bytesRead;
        }
        const after = await handle.stat();
        if (length > maximum || length !== before.size || fingerprint(before) !== fingerprint(after)) { throw new Error(); }
        const bytes = Buffer.from(buffer.subarray(0, length));
        return { bytes, modified: before.mtimeMs, fingerprint: fingerprint(before), digest: createHash('sha256').update(bytes).digest('hex') };
      } finally { await handle.close(); }
    } catch { throw new ApplicationError('REQUEST_VALIDATION_FAILED', ['The file must be a readable, unchanged regular file of at most 10 MiB. Select it again if it changed.']); }
  }
}
