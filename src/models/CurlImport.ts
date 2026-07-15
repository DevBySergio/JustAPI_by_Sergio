import type { JustRequest } from './Request';

export type CurlImportWarningCode =
  | 'UNSUPPORTED_OPTION'
  | 'DANGEROUS_OPTION'
  | 'MISSING_OPTION_VALUE'
  | 'AMBIGUOUS_OPTION'
  | 'LOCAL_FILE_REFERENCE'
  | 'MALFORMED_VALUE'
  | 'MULTIPLE_URLS'
  | 'CONFLICTING_BODY_OPTIONS'
  | 'SHELL_SYNTAX_LITERAL';

export interface CurlImportWarning {
  code: CurlImportWarningCode;
  token: string;
  tokenIndex: number;
  message: string;
}

export interface CurlImportParseResult {
  request: JustRequest;
  warnings: CurlImportWarning[];
}
