import type { HttpMethod } from './Request';
import type { RequestError } from './Response';

export interface HistoryEntry {
  id: string;
  timestamp: number;
  duration: number;
  statusCode: number;
  url: string;
  method: HttpMethod;
  responseSize: number;
  requestId?: string;
  collectionId?: string;
  contentType?: string;
  errorType?: RequestError['type'];
}
