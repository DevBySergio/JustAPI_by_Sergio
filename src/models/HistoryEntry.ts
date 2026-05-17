import { JustRequest } from './Request';
import { JustResponse } from './Response';

export interface HistoryEntry {
  id: string;
  request: JustRequest;
  response: JustResponse;
  timestamp: number;
  duration: number;
  statusCode: number;
  url: string;
  method: string;
}
