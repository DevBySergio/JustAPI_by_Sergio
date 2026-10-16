import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { JustResponse } from '../models/Response';
import { RESPONSE_SIZE_LIMITS } from '../models/Request';
import { ApplicationError } from './ApplicationError';

export const RESPONSE_DOWNLOAD_LIMITS = { maximumBytes: RESPONSE_SIZE_LIMITS.maximum, maximumEntries: 20 } as const;
interface BodyEntry { requestId: string; bytes: Buffer; fileName: string; }
export interface ResponseDownloadResult {
  responseId: string;
  status: 'saved' | 'cancelled';
  fileName?: string;
  bytes?: number;
}
interface DownloadOptions { maximumBytes?: number; maximumEntries?: number; beforeCommit?: () => Promise<void>; }

export function responseFileName(response: Pick<JustResponse, 'bodyType' | 'mimeType'>): string {
  const mime = response.mimeType?.toLowerCase();
  const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/avif': 'avif', 'application/pdf': 'pdf', 'application/zip': 'zip', 'text/html': 'html' };
  const extension = mime && extensions[mime] ? extensions[mime]
    : response.bodyType === 'json' ? 'json' : response.bodyType === 'xml' ? 'xml'
      : ['text', 'html'].includes(response.bodyType) ? (response.bodyType === 'html' ? 'html' : 'txt') : 'bin';
  return `response.${extension}`;
}

/** Session-only original entity bytes. The webview can select an ID, never bytes or a destination path. */
export class ResponseDownloadService {
  private readonly bodies = new Map<string, BodyEntry>();
  private size = 0;
  private generation = 0;
  private saving = false;
  private readonly maximumBytes: number;
  private readonly maximumEntries: number;
  constructor(private readonly pickDestination: (suggestedName: string) => Promise<string | undefined>, private readonly options: DownloadOptions = {}) {
    this.maximumBytes = options.maximumBytes ?? RESPONSE_DOWNLOAD_LIMITS.maximumBytes;
    this.maximumEntries = options.maximumEntries ?? RESPONSE_DOWNLOAD_LIMITS.maximumEntries;
    if (!Number.isInteger(this.maximumBytes) || this.maximumBytes < 1 || this.maximumBytes > RESPONSE_DOWNLOAD_LIMITS.maximumBytes
      || !Number.isInteger(this.maximumEntries) || this.maximumEntries < 1 || this.maximumEntries > RESPONSE_DOWNLOAD_LIMITS.maximumEntries) { throw new Error('Invalid response download limits.'); }
  }
  retain(requestId: string, bytes: Buffer, response: JustResponse): { download: NonNullable<JustResponse['download']>; released: string[] } {
    const released = this.releaseRequest(requestId); const responseId = randomUUID();
    if (response.error || response.statusCode === 0 || bytes.length !== response.size || bytes.length > this.maximumBytes) {
      return { download: { responseId, available: false }, released };
    }
    while (this.bodies.size >= this.maximumEntries || this.size + bytes.length > this.maximumBytes) {
      released.push(...this.release(this.bodies.keys().next().value!));
    }
    this.bodies.set(responseId, { requestId, bytes, fileName: responseFileName(response) }); this.size += bytes.length;
    return { download: { responseId, available: true }, released };
  }
  release(responseId: string): string[] {
    const body = this.bodies.get(responseId); if (!body) { return []; }
    this.size -= body.bytes.length; this.bodies.delete(responseId); return [responseId];
  }
  releaseRequest(requestId: string): string[] {
    const released: string[] = [];
    for (const [id, entry] of this.bodies) { if (entry.requestId === requestId) { released.push(...this.release(id)); } }
    return released;
  }
  reset(): void { this.generation++; this.bodies.clear(); this.size = 0; }
  async save(responseId: string): Promise<ResponseDownloadResult> {
    if (this.saving) { throw new ApplicationError('OPERATION_FAILED', ['Finish the open response save dialog before starting another download.']); }
    const name = this.bodies.get(responseId)?.fileName;
    if (!name) { throw new ApplicationError('RESPONSE_BODY_UNAVAILABLE'); }
    const generation = this.generation; this.saving = true;
    try {
      const destination = await this.pickDestination(name);
      if (!destination) { return { responseId, status: 'cancelled' }; }
      // Do not pin a potentially large buffer while a native picker is open.
      const entry = this.bodies.get(responseId);
      const current = () => generation === this.generation && this.bodies.get(responseId) === entry;
      if (!entry || !current()) { throw new ApplicationError('RESPONSE_BODY_UNAVAILABLE'); }
      const temporary = join(dirname(destination), `.justapi-response-${randomUUID()}.tmp`);
      try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(entry.bytes); await file.sync(); } finally { await file.close(); }
        await this.options.beforeCommit?.();
        if (!current()) { throw new ApplicationError('RESPONSE_BODY_UNAVAILABLE'); }
        await rename(temporary, destination);
      } catch (error) {
        if (error instanceof ApplicationError) { throw error; }
        throw new ApplicationError('OPERATION_FAILED', ['The response could not be saved. Check the destination and available disk space, then try again.']);
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
      // Refresh recency without retaining extra copies. A closed/replaced response remains released.
      if (current()) { this.bodies.delete(responseId); this.bodies.set(responseId, entry); }
      return { responseId, status: 'saved', fileName: basename(destination).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 1024) || name, bytes: entry.bytes.length };
    } finally { this.saving = false; }
  }
}
