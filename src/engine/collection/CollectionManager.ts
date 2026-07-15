import { randomUUID } from 'node:crypto';
import { Collection, CollectionItemRef, createDefaultCollection } from '../../models/Collection';
import { JustRequest, PersistedJustRequest } from '../../models/Request';
import { JsonFileStore } from '../../storage/JsonFileStore';
import { normalizePersistedRequest } from '../auth/AuthService';
import {
  assertCollectionGraph,
  CollectionIntegrityError,
  CollectionIntegrityIssueCode,
} from './CollectionGraph';

export interface CollectionRequestLifecycle {
  duplicateRequest?: (
    request: PersistedJustRequest,
    newRequestId: string
  ) => Promise<PersistedJustRequest>;
  afterRemove?: (
    removed: readonly PersistedJustRequest[],
    remaining: readonly PersistedJustRequest[]
  ) => Promise<void>;
}

interface ItemLocation {
  item: CollectionItemRef;
  parent: CollectionItemRef[];
  index: number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class CollectionManager {
  private collections: Collection[] = [];
  private requests: Map<string, PersistedJustRequest> = new Map();
  private onDidChange: (() => void) | null = null;

  constructor(
    private readonly store: JsonFileStore,
    private readonly requestLifecycle: CollectionRequestLifecycle = {}
  ) {}

  setOnDidChange(cb: () => void): void {
    this.onDidChange = cb;
  }

  private notify(): void {
    this.onDidChange?.();
  }

  async load(): Promise<void> {
    const data = await this.store.read<{
      collections: Collection[];
      requests: Array<PersistedJustRequest | JustRequest>;
    }>('collections');
    if (!data) {
      return;
    }

    const collections = clone(data.collections || []);
    const requests = (data.requests || []).map(request => normalizePersistedRequest(request));
    assertCollectionGraph(collections, requests);
    this.collections = collections;
    this.requests = new Map(requests.map(request => [request.id, request]));
  }

  async save(): Promise<void> {
    const requests = Array.from(this.requests.values());
    assertCollectionGraph(this.collections, requests);
    await this.writeState(this.collections, requests);
  }

  getCollections(): Collection[] {
    return clone(this.collections);
  }

  getRequests(): PersistedJustRequest[] {
    return clone(Array.from(this.requests.values()));
  }

  async replaceRequests(requests: readonly PersistedJustRequest[]): Promise<void> {
    const nextRequests = requests.map(request => normalizePersistedRequest(request));
    await this.commit(clone(this.collections), nextRequests);
  }

  getCollection(id: string): Collection | undefined {
    const collection = this.collections.find(candidate => candidate.id === id);
    return collection ? clone(collection) : undefined;
  }

  getRequest(id: string): PersistedJustRequest | undefined {
    const request = this.requests.get(id);
    return request ? clone(request) : undefined;
  }

  getRequestsForCollection(collectionId: string): PersistedJustRequest[] {
    const collection = this.collections.find(candidate => candidate.id === collectionId);
    if (!collection) {
      this.fail('COLLECTION_NOT_FOUND', collectionId);
    }
    const result: PersistedJustRequest[] = [];
    const visit = (items: readonly CollectionItemRef[]): void => {
      for (const item of items) {
        if (item.type === 'request' && item.requestId) {
          const request = this.requests.get(item.requestId);
          if (!request) {
            this.fail('MISSING_REQUEST_REFERENCE', item.requestId);
          }
          result.push(clone(request));
        } else if (item.type === 'folder' && item.items) {
          visit(item.items);
        }
      }
    };
    visit(collection.items);
    return result;
  }

  async createCollection(name: string): Promise<Collection> {
    const collections = clone(this.collections);
    const collection = createDefaultCollection(name);
    collections.push(collection);
    await this.commit(collections, this.getRequests());
    return clone(collection);
  }

  async updateCollection(collection: Collection): Promise<void> {
    assertCollectionGraph([collection], this.getRequests(), { requireEveryRequestOwned: false });
    const collections = clone(this.collections);
    const index = collections.findIndex(candidate => candidate.id === collection.id);
    if (index < 0) {
      this.fail('COLLECTION_NOT_FOUND', collection.id);
    }
    const updated = clone(collection);
    updated.updated = Date.now();
    collections[index] = updated;
    await this.commit(collections, this.getRequests());
  }

  /** Delete behavior is an explicit cascade: the collection tree and every request it owns are removed. */
  async deleteCollection(id: string): Promise<void> {
    const collections = clone(this.collections);
    const index = collections.findIndex(collection => collection.id === id);
    if (index < 0) {
      this.fail('COLLECTION_NOT_FOUND', id);
    }
    const requestIds = this.collectRequestIds(collections[index].items);
    const nextRequests = new Map(this.getRequests().map(request => [request.id, request]));
    const removed: PersistedJustRequest[] = [];
    for (const requestId of requestIds) {
      const request = nextRequests.get(requestId);
      if (request) {
        removed.push(request);
        nextRequests.delete(requestId);
      }
    }
    collections.splice(index, 1);
    await this.commit(collections, Array.from(nextRequests.values()));
    await this.requestLifecycle.afterRemove?.(removed, this.getRequests());
  }

  async duplicateCollection(id: string): Promise<Collection | undefined> {
    const original = this.collections.find(collection => collection.id === id);
    if (!original) {
      this.fail('COLLECTION_NOT_FOUND', id);
    }

    const clonedRequests: PersistedJustRequest[] = [];
    const cloneItems = async (items: readonly CollectionItemRef[]): Promise<CollectionItemRef[]> => {
      const copies: CollectionItemRef[] = [];
      for (const item of items) {
        if (item.type === 'request' && item.requestId) {
          const originalRequest = this.requests.get(item.requestId);
          if (!originalRequest) {
            this.fail('MISSING_REQUEST_REFERENCE', item.requestId);
          }
          const requestId = randomUUID();
          const request = this.requestLifecycle.duplicateRequest
            ? await this.requestLifecycle.duplicateRequest(clone(originalRequest), requestId)
            : {
                ...clone(originalRequest),
                id: requestId,
                created: Date.now(),
                updated: Date.now(),
              };
          clonedRequests.push(request);
          copies.push({ ...clone(item), id: requestId, requestId, name: request.name });
        } else if (item.type === 'folder' && item.items) {
          copies.push({
            ...clone(item),
            id: randomUUID(),
            items: await cloneItems(item.items),
          });
        }
      }
      return copies;
    };

    try {
      const now = Date.now();
      const duplicate: Collection = {
        ...clone(original),
        id: randomUUID(),
        name: `${original.name} (Copy)`,
        items: await cloneItems(original.items),
        variables: original.variables.map(variable => ({ ...clone(variable), id: randomUUID() })),
        created: now,
        updated: now,
      };
      await this.commit(
        [...this.getCollections(), duplicate],
        [...this.getRequests(), ...clonedRequests]
      );
      return clone(duplicate);
    } catch (error) {
      await this.requestLifecycle.afterRemove?.(clonedRequests, this.getRequests());
      throw error;
    }
  }

  async saveRequest(
    request: PersistedJustRequest | JustRequest,
    collectionId: string,
    parentId?: string
  ): Promise<void> {
    const collections = clone(this.collections);
    const collection = collections.find(candidate => candidate.id === collectionId);
    if (!collection) {
      this.fail('COLLECTION_NOT_FOUND', collectionId);
    }
    const destination = parentId ? this.findItem(collection.items, parentId) : undefined;
    if (parentId && (!destination || destination.item.type !== 'folder' || !destination.item.items)) {
      this.fail('INVALID_PARENT', parentId);
    }

    const persistedRequest = normalizePersistedRequest(request);
    persistedRequest.updated = Date.now();
    let existingRef: CollectionItemRef | undefined;
    for (const candidate of collections) {
      const location = this.findRequest(candidate.items, persistedRequest.id);
      if (location) {
        existingRef = location.item;
        location.parent.splice(location.index, 1);
        candidate.updated = Date.now();
        break;
      }
    }

    const item: CollectionItemRef = existingRef
      ? { ...existingRef, name: persistedRequest.name, requestId: persistedRequest.id }
      : {
          type: 'request',
          id: persistedRequest.id,
          name: persistedRequest.name,
          requestId: persistedRequest.id,
        };
    const targetItems = destination?.item.items || collection.items;
    targetItems.push(item);
    collection.updated = Date.now();

    const requests = new Map(this.getRequests().map(candidate => [candidate.id, candidate]));
    requests.set(persistedRequest.id, persistedRequest);
    await this.commit(collections, Array.from(requests.values()));
  }

  async deleteRequest(requestId: string, collectionId: string): Promise<void> {
    const collections = clone(this.collections);
    const collection = collections.find(candidate => candidate.id === collectionId);
    if (!collection) {
      this.fail('COLLECTION_NOT_FOUND', collectionId);
    }
    const location = this.findRequest(collection.items, requestId);
    if (!location) {
      this.fail('REQUEST_NOT_FOUND', requestId);
    }
    const removed = this.requests.get(requestId);
    if (!removed) {
      this.fail('REQUEST_NOT_FOUND', requestId);
    }

    location.parent.splice(location.index, 1);
    collection.updated = Date.now();
    const requests = new Map(this.getRequests().map(request => [request.id, request]));
    requests.delete(requestId);
    await this.commit(collections, Array.from(requests.values()));
    await this.requestLifecycle.afterRemove?.([clone(removed)], this.getRequests());
  }

  async moveItem(
    itemId: string,
    sourceCollectionId: string,
    targetCollectionId: string,
    targetParentId?: string,
    targetIndex?: number
  ): Promise<void> {
    const collections = clone(this.collections);
    const source = collections.find(collection => collection.id === sourceCollectionId);
    const target = collections.find(collection => collection.id === targetCollectionId);
    if (!source || !target) {
      this.fail('COLLECTION_NOT_FOUND', !source ? sourceCollectionId : targetCollectionId);
    }
    const sourceLocation = this.findItem(source.items, itemId);
    if (!sourceLocation) {
      this.fail('ITEM_NOT_FOUND', itemId);
    }
    if (targetParentId && this.containsItem(sourceLocation.item, targetParentId)) {
      this.fail('DESTINATION_IS_DESCENDANT', targetParentId);
    }
    const parentLocation = targetParentId ? this.findItem(target.items, targetParentId) : undefined;
    if (targetParentId
      && (!parentLocation || parentLocation.item.type !== 'folder' || !parentLocation.item.items)) {
      this.fail('INVALID_PARENT', targetParentId);
    }

    sourceLocation.parent.splice(sourceLocation.index, 1);
    const targetItems = parentLocation?.item.items || target.items;
    const insertionIndex = targetIndex ?? targetItems.length;
    if (!Number.isInteger(insertionIndex) || insertionIndex < 0 || insertionIndex > targetItems.length) {
      this.fail('INVALID_DESTINATION', itemId);
    }
    targetItems.splice(insertionIndex, 0, sourceLocation.item);
    const now = Date.now();
    source.updated = now;
    target.updated = now;
    await this.commit(collections, this.getRequests());
  }

  async addFolder(
    collectionId: string,
    name: string,
    parentId?: string,
    targetIndex?: number
  ): Promise<CollectionItemRef | undefined> {
    const collections = clone(this.collections);
    const collection = collections.find(candidate => candidate.id === collectionId);
    if (!collection) {
      this.fail('COLLECTION_NOT_FOUND', collectionId);
    }
    const parent = parentId ? this.findItem(collection.items, parentId) : undefined;
    if (parentId && (!parent || parent.item.type !== 'folder' || !parent.item.items)) {
      this.fail('INVALID_PARENT', parentId);
    }
    const targetItems = parent?.item.items || collection.items;
    const insertionIndex = targetIndex ?? targetItems.length;
    if (!Number.isInteger(insertionIndex) || insertionIndex < 0 || insertionIndex > targetItems.length) {
      this.fail('INVALID_DESTINATION', collectionId);
    }
    const folder: CollectionItemRef = {
      type: 'folder',
      id: randomUUID(),
      name,
      items: [],
    };
    targetItems.splice(insertionIndex, 0, folder);
    collection.updated = Date.now();
    await this.commit(collections, this.getRequests());
    return clone(folder);
  }

  async importCollection(
    collection: Collection,
    requests: Array<PersistedJustRequest | JustRequest>
  ): Promise<void> {
    const importedRequests = requests.map(request => normalizePersistedRequest(request));
    assertCollectionGraph([collection], importedRequests);
    const importedCollection = clone(collection);
    await this.commit(
      [...this.getCollections(), importedCollection],
      [...this.getRequests(), ...importedRequests]
    );
  }

  private async commit(
    collections: Collection[],
    requests: PersistedJustRequest[]
  ): Promise<void> {
    assertCollectionGraph(collections, requests);
    await this.writeState(collections, requests);
    this.collections = collections;
    this.requests = new Map(requests.map(request => [request.id, request]));
    this.notify();
  }

  private async writeState(
    collections: readonly Collection[],
    requests: readonly PersistedJustRequest[]
  ): Promise<void> {
    await this.store.write('collections', {
      collections,
      requests,
    });
  }

  private findItem(items: CollectionItemRef[], itemId: string): ItemLocation | undefined {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.id === itemId) {
        return { item, parent: items, index };
      }
      if (item.type === 'folder' && item.items) {
        const nested = this.findItem(item.items, itemId);
        if (nested) {
          return nested;
        }
      }
    }
    return undefined;
  }

  private findRequest(items: CollectionItemRef[], requestId: string): ItemLocation | undefined {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.type === 'request' && item.requestId === requestId) {
        return { item, parent: items, index };
      }
      if (item.type === 'folder' && item.items) {
        const nested = this.findRequest(item.items, requestId);
        if (nested) {
          return nested;
        }
      }
    }
    return undefined;
  }

  private containsItem(item: CollectionItemRef, itemId: string): boolean {
    if (item.id === itemId) {
      return true;
    }
    return item.type === 'folder'
      && !!item.items?.some(child => this.containsItem(child, itemId));
  }

  private collectRequestIds(items: readonly CollectionItemRef[]): string[] {
    const result: string[] = [];
    for (const item of items) {
      if (item.type === 'request' && item.requestId) {
        result.push(item.requestId);
      } else if (item.type === 'folder' && item.items) {
        result.push(...this.collectRequestIds(item.items));
      }
    }
    return result;
  }

  private fail(code: CollectionIntegrityIssueCode, entityId?: string): never {
    throw new CollectionIntegrityError([{ code, entityId }]);
  }
}
