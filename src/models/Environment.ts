import type { Variable } from './Variable';

export const ENV_FILE_LIMITS = { bytes: 1024 * 1024, variables: 1000, valueCharacters: 64 * 1024 } as const;
export interface EnvDiagnostic { line: number; code: 'INVALID_ASSIGNMENT' | 'INVALID_NAME' | 'UNTERMINATED_QUOTE' | 'TRAILING_CONTENT' | 'DUPLICATE_NAME' | 'VALUE_TOO_LARGE' | 'TOO_MANY_VARIABLES'; }
export interface EnvImportPreview {
  previewId: string;
  fileName: string;
  variables: Variable[];
  diagnostics: EnvDiagnostic[];
  targetSetId?: string;
}
export interface EnvWatch { setId: string; fileName: string; }
