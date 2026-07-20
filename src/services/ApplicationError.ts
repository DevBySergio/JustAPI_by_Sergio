import { ProtocolErrorCode } from '../models/MessageProtocol';

export class ApplicationError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    readonly details?: string[],
    readonly executionId?: string
  ) {
    super(code);
    this.name = 'ApplicationError';
  }
}

