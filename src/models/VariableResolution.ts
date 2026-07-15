import type { JustRequest } from './Request';

export type VariableDiagnosticCode =
  | 'MISSING_VARIABLE'
  | 'DISABLED_VARIABLE'
  | 'DUPLICATE_VARIABLE'
  | 'CYCLIC_VARIABLE'
  | 'MAX_DEPTH_EXCEEDED'
  | 'INVALID_VARIABLE'
  | 'INVALID_TEMPLATE'
  | 'INPUT_LIMIT_EXCEEDED'
  | 'OUTPUT_LIMIT_EXCEEDED';

export interface VariableDiagnostic {
  code: VariableDiagnosticCode;
  location: string;
  variable?: string;
  path?: string[];
}

export interface VariableResolutionResult {
  value: string;
  diagnostics: VariableDiagnostic[];
}

export interface RequestResolutionResult {
  ok: boolean;
  request: JustRequest;
  diagnostics: VariableDiagnostic[];
}
