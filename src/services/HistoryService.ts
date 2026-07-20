import { randomUUID } from 'node:crypto';
import { HistoryEntry } from '../models/HistoryEntry';
import { JustRequest } from '../models/Request';
import { JustResponse } from '../models/Response';
import { createHistorySummary } from '../storage/HistorySummary';
import { DataStore } from './DataStore';

export interface HistoryRecordContext {
  collectionId?: string;
  hasSavedRequest: boolean;
}

export interface HistoryServiceOptions {
  now?: () => number;
  createId?: () => string;
}

export class HistoryService {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(
    private readonly store: DataStore,
    options: HistoryServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  async list(filter?: string, limit?: number): Promise<HistoryEntry[]> {
    const stored = await this.store.read<HistoryEntry[]>('history');
    let entries = [...(stored ?? [])];
    if (filter) {
      const normalizedFilter = filter.toLowerCase();
      entries = entries.filter(entry =>
        entry.url.toLowerCase().includes(normalizedFilter)
        || entry.method.toLowerCase().includes(normalizedFilter)
        || entry.statusCode.toString().includes(normalizedFilter)
      );
    }
    entries.sort((left, right) => right.timestamp - left.timestamp);
    return limit && limit > 0 ? entries.slice(0, limit) : entries;
  }

  async record(
    request: JustRequest,
    response: JustResponse,
    context: HistoryRecordContext
  ): Promise<HistoryEntry> {
    const entry = createHistorySummary(request, response, {
      id: this.createId(),
      timestamp: this.now(),
      ...(context.hasSavedRequest && context.collectionId
        ? { requestId: request.id, collectionId: context.collectionId }
        : {}),
    });
    const entries = await this.store.read<HistoryEntry[]>('history') ?? [];
    entries.unshift(entry);
    await this.store.write('history', entries);
    return entry;
  }

  async clear(): Promise<HistoryEntry[]> {
    await this.store.write('history', []);
    return [];
  }

  async delete(entryId: string): Promise<HistoryEntry[]> {
    const entries = await this.store.read<HistoryEntry[]>('history') ?? [];
    const remaining = entries.filter(entry => entry.id !== entryId);
    if (remaining.length === entries.length) {
      throw new Error('History entry not found');
    }
    await this.store.write('history', remaining);
    return remaining;
  }
}

