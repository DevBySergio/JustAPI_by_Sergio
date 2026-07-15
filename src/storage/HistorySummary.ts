import { randomUUID } from 'node:crypto';
import type { HistoryEntry } from '../models/HistoryEntry';
import type { HttpMethod, JustRequest } from '../models/Request';
import type { JustResponse, RequestError } from '../models/Response';

export const HISTORY_LIMITS = {
  maximumEntries: 200,
  maximumEnvelopeBytes: 2 * 1024 * 1024,
  maximumUrlLength: 16 * 1024,
  maximumContentTypeLength: 256,
} as const;

const HTTP_METHODS = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);

const ERROR_TYPES = new Set<RequestError['type']>([
  'network',
  'timeout',
  'dns',
  'ssl',
  'socket',
  'invalid-url',
  'invalid-response',
  'redirect',
  'decompression',
  'response-too-large',
  'aborted',
  'unknown',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{1,64}$/.test(value);
}

function boundedNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function boundedInteger(value: unknown, fallback = 0): number {
  return Math.floor(boundedNumber(value, fallback));
}

function boundedIntegerAtMost(value: unknown, maximum: number, fallback = 0): number {
  return Math.min(boundedInteger(value, fallback), maximum);
}

function boundedString(value: unknown, maximumLength: number): string {
  return typeof value === 'string' ? value.slice(0, maximumLength) : '';
}

export function redactHistoryUrl(value: string): string {
  const bounded = value.slice(0, HISTORY_LIMITS.maximumUrlLength);
  try {
    const parsed = new URL(bounded);
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    for (const key of Array.from(parsed.searchParams.keys())) {
      parsed.searchParams.set(key, '{{redacted}}');
    }
    return parsed.toString().slice(0, HISTORY_LIMITS.maximumUrlLength);
  } catch {
    const queryIndex = bounded.indexOf('?');
    const hashIndex = bounded.indexOf('#');
    const cutAt = [queryIndex, hashIndex]
      .filter(index => index >= 0)
      .reduce((minimum, index) => Math.min(minimum, index), bounded.length);
    const base = bounded.slice(0, cutAt);
    return queryIndex >= 0 ? `${base}?{{redacted}}` : base;
  }
}

function safeContentType(response: JustResponse): string | undefined {
  const header = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'content-type');
  return allowlistedContentType(header?.[1]);
}

function allowlistedContentType(value: unknown): string | undefined {
  const mediaType = typeof value === 'string'
    ? value.split(';', 1)[0].trim().toLowerCase()
    : undefined;
  if (!mediaType || mediaType.length > HISTORY_LIMITS.maximumContentTypeLength) {
    return undefined;
  }
  return /^(application\/(?:json|xml|problem\+json|octet-stream)|text\/[a-z0-9.+-]+|image\/[a-z0-9.+-]+)$/.test(mediaType)
    ? mediaType
    : undefined;
}

export interface HistorySummaryOptions {
  id?: string;
  timestamp?: number;
  requestId?: string;
  collectionId?: string;
}

export function createHistorySummary(
  request: JustRequest,
  response: JustResponse,
  options: HistorySummaryOptions = {}
): HistoryEntry {
  const contentType = safeContentType(response);
  const errorType = response.error && ERROR_TYPES.has(response.error.type)
    ? response.error.type
    : undefined;
  return {
    id: options.id && isIdentifier(options.id) ? options.id : randomUUID(),
    timestamp: boundedNumber(options.timestamp, Date.now()),
    duration: boundedNumber(response.duration),
    statusCode: boundedIntegerAtMost(response.statusCode, 999),
    url: redactHistoryUrl(request.url),
    method: request.method,
    responseSize: boundedIntegerAtMost(response.size, 100 * 1024 * 1024),
    ...(options.requestId && isIdentifier(options.requestId) ? { requestId: options.requestId } : {}),
    ...(options.collectionId && isIdentifier(options.collectionId) ? { collectionId: options.collectionId } : {}),
    ...(contentType ? { contentType } : {}),
    ...(errorType ? { errorType } : {}),
  };
}

function normalizeSummary(value: Record<string, unknown>): HistoryEntry | null {
  if (!isIdentifier(value.id)
    || typeof value.method !== 'string'
    || !HTTP_METHODS.has(value.method as HttpMethod)
    || typeof value.url !== 'string') {
    return null;
  }
  const contentType = allowlistedContentType(
    boundedString(value.contentType, HISTORY_LIMITS.maximumContentTypeLength)
  );
  const errorType = typeof value.errorType === 'string' && ERROR_TYPES.has(value.errorType as RequestError['type'])
    ? value.errorType as RequestError['type']
    : undefined;
  return {
    id: value.id,
    timestamp: boundedNumber(value.timestamp),
    duration: boundedNumber(value.duration),
    statusCode: boundedIntegerAtMost(value.statusCode, 999),
    url: redactHistoryUrl(value.url),
    method: value.method as HttpMethod,
    responseSize: boundedIntegerAtMost(value.responseSize, 100 * 1024 * 1024),
    ...(isIdentifier(value.requestId) ? { requestId: value.requestId } : {}),
    ...(isIdentifier(value.collectionId) ? { collectionId: value.collectionId } : {}),
    ...(contentType ? { contentType } : {}),
    ...(errorType ? { errorType } : {}),
  };
}

function migrateLegacyEntry(value: Record<string, unknown>): HistoryEntry | null {
  if (!isRecord(value.request) || !isRecord(value.response)) {
    return null;
  }
  const request = value.request as unknown as JustRequest;
  const response = value.response as unknown as JustResponse;
  if (!isIdentifier(value.id)
    || typeof request.url !== 'string'
    || typeof request.method !== 'string'
    || !HTTP_METHODS.has(request.method as HttpMethod)
    || !isRecord(response.headers)) {
    return null;
  }
  return createHistorySummary(request, response, {
    id: value.id,
    timestamp: boundedNumber(value.timestamp),
  });
}

function envelopeByteLength(entries: HistoryEntry[]): number {
  return Buffer.byteLength(`${JSON.stringify({
    schemaVersion: 2,
    revision: Number.MAX_SAFE_INTEGER,
    updatedAt: Number.MAX_SAFE_INTEGER,
    data: entries,
  }, null, 2)}\n`, 'utf8');
}

export function normalizeHistoryData(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('History storage must contain an array.');
  }

  const entries = value.map(candidate => {
    if (!isRecord(candidate)) {
      throw new Error('History storage contains a malformed entry.');
    }
    const normalized = Object.prototype.hasOwnProperty.call(candidate, 'responseSize')
      ? normalizeSummary(candidate)
      : migrateLegacyEntry(candidate);
    if (!normalized) {
      throw new Error('History storage contains a malformed entry.');
    }
    return normalized;
  });

  entries.sort((left, right) => right.timestamp - left.timestamp);
  if (entries.length > HISTORY_LIMITS.maximumEntries) {
    entries.length = HISTORY_LIMITS.maximumEntries;
  }
  while (entries.length > 0 && envelopeByteLength(entries) > HISTORY_LIMITS.maximumEnvelopeBytes) {
    entries.pop();
  }
  return entries;
}
