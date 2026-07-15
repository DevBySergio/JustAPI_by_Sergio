import type { Collection, CollectionItemRef } from '../../models/Collection';

export const COLLECTION_GRAPH_LIMITS = {
  maximumCollections: 1_000,
  maximumRequests: 10_000,
  maximumItems: 10_000,
  maximumDepth: 50,
} as const;

export type CollectionIntegrityIssueCode =
  | 'TOO_MANY_COLLECTIONS'
  | 'TOO_MANY_REQUESTS'
  | 'TOO_MANY_ITEMS'
  | 'MAXIMUM_DEPTH_EXCEEDED'
  | 'DUPLICATE_COLLECTION_ID'
  | 'DUPLICATE_ITEM_ID'
  | 'DUPLICATE_REQUEST_ID'
  | 'DUPLICATE_REQUEST_REFERENCE'
  | 'MISSING_REQUEST_REFERENCE'
  | 'ORPHANED_REQUEST'
  | 'CYCLIC_ITEM_GRAPH'
  | 'INVALID_ITEM'
  | 'COLLECTION_NOT_FOUND'
  | 'REQUEST_NOT_FOUND'
  | 'ITEM_NOT_FOUND'
  | 'INVALID_PARENT'
  | 'INVALID_DESTINATION'
  | 'DESTINATION_IS_DESCENDANT';

export interface CollectionIntegrityIssue {
  code: CollectionIntegrityIssueCode;
  entityId?: string;
}

export class CollectionIntegrityError extends Error {
  constructor(readonly issues: readonly CollectionIntegrityIssue[]) {
    super(`Collection integrity check failed: ${issues.map(issue => issue.code).join(', ')}`);
    this.name = 'CollectionIntegrityError';
  }
}

export interface CollectionGraphValidationOptions {
  requireEveryRequestOwned?: boolean;
}

interface RequestIdentity {
  id: string;
}

/**
 * Collection graph invariants:
 * - collection, item, and request identifiers are unique in their namespaces;
 * - every request item resolves to exactly one stored request;
 * - every stored request is owned by exactly one tree item;
 * - the nested item graph is acyclic, bounded to 50 levels and 10,000 items;
 * - array order is significant and is never normalized by validation.
 */
export function validateCollectionGraph(
  collections: readonly Collection[],
  requests: readonly RequestIdentity[],
  options: CollectionGraphValidationOptions = {}
): CollectionIntegrityIssue[] {
  const issues: CollectionIntegrityIssue[] = [];
  const collectionIds = new Set<string>();
  const requestIds = new Set<string>();
  const itemIds = new Set<string>();
  const referencedRequestIds = new Set<string>();
  let itemCount = 0;

  if (collections.length > COLLECTION_GRAPH_LIMITS.maximumCollections) {
    issues.push({ code: 'TOO_MANY_COLLECTIONS' });
  }
  if (requests.length > COLLECTION_GRAPH_LIMITS.maximumRequests) {
    issues.push({ code: 'TOO_MANY_REQUESTS' });
  }

  for (const request of requests) {
    if (requestIds.has(request.id)) {
      issues.push({ code: 'DUPLICATE_REQUEST_ID', entityId: request.id });
    }
    requestIds.add(request.id);
  }

  const visit = (
    item: CollectionItemRef,
    depth: number,
    ancestors: Set<object>
  ): void => {
    itemCount += 1;
    if (itemCount > COLLECTION_GRAPH_LIMITS.maximumItems) {
      if (!issues.some(issue => issue.code === 'TOO_MANY_ITEMS')) {
        issues.push({ code: 'TOO_MANY_ITEMS' });
      }
      return;
    }
    if (!item || typeof item !== 'object' || (item.type !== 'folder' && item.type !== 'request')) {
      issues.push({ code: 'INVALID_ITEM' });
      return;
    }
    if (depth > COLLECTION_GRAPH_LIMITS.maximumDepth) {
      issues.push({ code: 'MAXIMUM_DEPTH_EXCEEDED', entityId: item.id });
      return;
    }
    if (ancestors.has(item)) {
      issues.push({ code: 'CYCLIC_ITEM_GRAPH', entityId: item.id });
      return;
    }
    if (itemIds.has(item.id)) {
      issues.push({ code: 'DUPLICATE_ITEM_ID', entityId: item.id });
    }
    itemIds.add(item.id);

    if (item.type === 'request') {
      if (!item.requestId || !requestIds.has(item.requestId)) {
        issues.push({ code: 'MISSING_REQUEST_REFERENCE', entityId: item.requestId || item.id });
      } else if (referencedRequestIds.has(item.requestId)) {
        issues.push({ code: 'DUPLICATE_REQUEST_REFERENCE', entityId: item.requestId });
      } else {
        referencedRequestIds.add(item.requestId);
      }
      if (item.items !== undefined) {
        issues.push({ code: 'INVALID_ITEM', entityId: item.id });
      }
      return;
    }

    if (!Array.isArray(item.items) || item.requestId !== undefined) {
      issues.push({ code: 'INVALID_ITEM', entityId: item.id });
      return;
    }
    ancestors.add(item);
    for (const child of item.items) {
      visit(child, depth + 1, ancestors);
    }
    ancestors.delete(item);
  };

  for (const collection of collections) {
    if (collectionIds.has(collection.id)) {
      issues.push({ code: 'DUPLICATE_COLLECTION_ID', entityId: collection.id });
    }
    collectionIds.add(collection.id);
    if (!Array.isArray(collection.items)) {
      issues.push({ code: 'INVALID_ITEM', entityId: collection.id });
      continue;
    }
    for (const item of collection.items) {
      visit(item, 1, new Set());
    }
  }

  if (options.requireEveryRequestOwned !== false) {
    for (const requestId of requestIds) {
      if (!referencedRequestIds.has(requestId)) {
        issues.push({ code: 'ORPHANED_REQUEST', entityId: requestId });
      }
    }
  }

  return issues;
}

export function assertCollectionGraph(
  collections: readonly Collection[],
  requests: readonly RequestIdentity[],
  options?: CollectionGraphValidationOptions
): void {
  const issues = validateCollectionGraph(collections, requests, options);
  if (issues.length > 0) {
    throw new CollectionIntegrityError(issues);
  }
}
