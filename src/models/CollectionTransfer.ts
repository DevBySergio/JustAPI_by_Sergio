import type { Collection } from './Collection';
import type { JustRequest } from './Request';

export const COLLECTION_TRANSFER_SCHEMA_VERSION = 2 as const;

/**
 * Canonical collection interchange format. Legacy v1 documents omitted
 * `schemaVersion`; imports migrate those documents in memory and every new
 * export writes v2.
 */
export interface CollectionTransferDocument {
  schemaVersion: typeof COLLECTION_TRANSFER_SCHEMA_VERSION;
  collection: Collection;
  requests: JustRequest[];
}

export interface LegacyCollectionTransferDocument {
  collection: Collection;
  requests: JustRequest[];
}

