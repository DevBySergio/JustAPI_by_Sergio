import { ProtocolErrorCode } from '../models/MessageProtocol';
import type { VariableDiagnostic } from '../models/VariableResolution';

export function preflightError(diagnostics: VariableDiagnostic[], executionId?: string): ApplicationError {
  const code = diagnostics.some(value => value.code === 'AUTH_CONFLICT') ? 'AUTH_CONFLICT'
    : diagnostics.some(value => ['INVALID_BODY', 'FILE_NOT_SELECTED', 'FILE_CHANGED', 'FILE_UNAVAILABLE'].includes(value.code) || value.code === 'INVALID_URL' || value.code === 'INVALID_HEADER' || value.code === 'INVALID_PATH_PARAMETER')
      ? 'REQUEST_VALIDATION_FAILED' : 'VARIABLE_RESOLUTION_FAILED';
  return new ApplicationError(code, diagnostics.map(value => `${value.code}: ${value.location}`), executionId);
}

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
