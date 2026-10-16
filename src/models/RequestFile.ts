/** Opaque selection metadata. Paths and bytes never enter request documents or the webview. */
export interface RequestFile {
  id: string;
  name: string;
  size: number;
  lastModified: number;
}
export interface MultipartFile {
  id: string;
  key: string;
  enabled: boolean;
  file?: RequestFile;
  contentType?: string;
}
export const FILE_UPLOAD_LIMITS = { maximumFileBytes: 10 * 1024 * 1024, maximumBodyBytes: 25 * 1024 * 1024, maximumFiles: 20, maximumSelections: 1000 } as const;
