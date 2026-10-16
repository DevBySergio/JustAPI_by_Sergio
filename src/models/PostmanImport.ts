/** The preview contains counts and diagnostics only. Source values stay in the host. */
export interface PostmanImportPreview {
  previewId: string;
  fileName: string;
  name: string;
  kind: 'collection' | 'environment';
  requests: number;
  folders: number;
  variables: number;
  credentials: number;
  skippedRequests: number;
  skippedVariables: number;
  diagnosticCount: number;
  diagnostics: PostmanImportDiagnostic[];
}
export const POSTMAN_DIAGNOSTIC_CODES = [
  'SCRIPTS_OMITTED', 'EXAMPLES_OMITTED', 'DESCRIPTION_OMITTED', 'SETTINGS_OMITTED',
  'REQUEST_SKIPPED', 'VARIABLE_SKIPPED', 'SECRET_VARIABLE_SKIPPED', 'AUTH_PLACEHOLDER',
  'VARIABLE_PRECEDENCE', 'COOKIES_OMITTED',
] as const;
export interface PostmanImportDiagnostic {
  code: typeof POSTMAN_DIAGNOSTIC_CODES[number];
  location: string;
}
