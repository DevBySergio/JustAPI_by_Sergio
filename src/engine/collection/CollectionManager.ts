import { Collection, CollectionItemRef, createDefaultCollection } from '../../models/Collection';
import { JustRequest, PersistedJustRequest } from '../../models/Request';
import { JsonFileStore } from '../../storage/JsonFileStore';
import { normalizePersistedRequest } from '../auth/AuthService';

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

export class CollectionManager {
  private collections: Collection[] = [];
  private requests: Map<string, PersistedJustRequest> = new Map();
  private store: JsonFileStore;
  private onDidChange: (() => void) | null = null;

  constructor(store: JsonFileStore, private readonly requestLifecycle: CollectionRequestLifecycle = {}) {
    this.store = store;
  }

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
    if (data) {
      this.collections = data.collections || [];
      this.requests.clear();
      if (data.requests) {
        for (const req of data.requests) {
          this.requests.set(req.id, normalizePersistedRequest(req));
        }
      }
    }
  }

  async save(): Promise<void> {
    await this.store.write('collections', {
      collections: this.collections,
      requests: Array.from(this.requests.values()),
    });
  }

  getCollections(): Collection[] {
    return this.collections;
  }

  getRequests(): PersistedJustRequest[] {
    return Array.from(this.requests.values());
  }

  async replaceRequests(requests: readonly PersistedJustRequest[]): Promise<void> {
    this.requests = new Map(requests.map(request => [request.id, request]));
    await this.save();
    this.notify();
  }

  getCollection(id: string): Collection | undefined {
    return this.collections.find(c => c.id === id);
  }

  async createCollection(name: string): Promise<Collection> {
    const collection = createDefaultCollection(name);
    this.collections.push(collection);
    await this.save();
    this.notify();
    return collection;
  }

  async updateCollection(collection: Collection): Promise<void> {
    const idx = this.collections.findIndex(c => c.id === collection.id);
    if (idx >= 0) {
      collection.updated = Date.now();
      this.collections[idx] = collection;
      await this.save();
      this.notify();
    }
  }

  async deleteCollection(id: string): Promise<void> {
    const collection = this.collections.find(c => c.id === id);
    if (collection) {
      this.collections = this.collections.filter(c => c.id !== id);
      await this.save();
      this.notify();
    }
  }

  async duplicateCollection(id: string): Promise<Collection | undefined> {
    const original = this.collections.find(c => c.id === id);
    if (!original) { return undefined; }
    const dup = JSON.parse(JSON.stringify(original)) as Collection;
    dup.id = crypto.randomUUID();
    dup.name = `${original.name} (Copy)`;
    dup.created = Date.now();
    dup.updated = Date.now();

    // Clone all requests belonging to this collection with new IDs
    const clonedRequests: PersistedJustRequest[] = [];
    const cloneItems = async (items: CollectionItemRef[]): Promise<void> => {
      for (const item of items) {
        if (item.type === 'request' && item.requestId) {
          const originalReq = this.requests.get(item.requestId);
          if (originalReq) {
            const newReqId = crypto.randomUUID();
            const clonedReq = this.requestLifecycle.duplicateRequest
              ? await this.requestLifecycle.duplicateRequest(originalReq, newReqId)
              : { ...JSON.parse(JSON.stringify(originalReq)), id: newReqId, created: Date.now(), updated: Date.now() };
            clonedRequests.push(clonedReq);
            item.id = newReqId;
            item.requestId = newReqId;
          }
        }
        if (item.items) {
          await cloneItems(item.items);
        }
      }
    };
    try {
      await cloneItems(dup.items);
      for (const request of clonedRequests) {
        this.requests.set(request.id, request);
      }
      this.collections.push(dup);
      await this.save();
    } catch (error) {
      this.collections = this.collections.filter(collection => collection.id !== dup.id);
      for (const request of clonedRequests) {
        this.requests.delete(request.id);
      }
      await this.requestLifecycle.afterRemove?.(clonedRequests, this.getRequests());
      throw error;
    }
    this.notify();
    return dup;
  }

  getRequest(id: string): PersistedJustRequest | undefined {
    return this.requests.get(id);
  }

  async saveRequest(
    request: PersistedJustRequest | JustRequest,
    collectionId: string,
    parentId?: string
  ): Promise<void> {
    const persistedRequest = normalizePersistedRequest(request);
    persistedRequest.updated = Date.now();
    this.requests.set(persistedRequest.id, persistedRequest);

    const collection = this.collections.find(c => c.id === collectionId);
    if (collection) {
      if (parentId) {
        this.addRequestToFolder(collection.items, parentId, persistedRequest.id, persistedRequest.name);
      } else {
        const existing = collection.items.find(i => i.type === 'request' && i.requestId === persistedRequest.id);
        if (!existing) {
          collection.items.push({
            type: 'request',
            id: persistedRequest.id,
            name: persistedRequest.name,
            requestId: persistedRequest.id,
          });
        }
      }
      collection.updated = Date.now();
    }

    await this.save();
    this.notify();
  }

  async deleteRequest(requestId: string, collectionId: string): Promise<void> {
    const removed = this.requests.get(requestId);
    this.requests.delete(requestId);
    const collection = this.collections.find(c => c.id === collectionId);
    if (collection) {
      this.removeItem(collection.items, requestId);
      collection.updated = Date.now();
    }
    await this.save();
    if (removed) {
      await this.requestLifecycle.afterRemove?.([removed], this.getRequests());
    }
    this.notify();
  }

  async moveItem(
    itemId: string,
    sourceCollectionId: string,
    targetCollectionId: string,
    targetParentId?: string
  ): Promise<void> {
    const sourceCol = this.collections.find(c => c.id === sourceCollectionId);
    const targetCol = this.collections.find(c => c.id === targetCollectionId);
    if (!sourceCol || !targetCol) { return; }

    const item = this.extractItem(sourceCol.items, itemId);
    if (!item) { return; }

    if (targetParentId) {
      this.addToFolder(targetCol.items, targetParentId, item);
    } else {
      targetCol.items.push(item);
    }

    sourceCol.updated = Date.now();
    targetCol.updated = Date.now();
    await this.save();
    this.notify();
  }

  async addFolder(collectionId: string, name: string, parentId?: string): Promise<CollectionItemRef | undefined> {
    const collection = this.collections.find(c => c.id === collectionId);
    if (!collection) { return undefined; }

    const folder: CollectionItemRef = {
      type: 'folder',
      id: crypto.randomUUID(),
      name,
      items: [],
    };

    if (parentId) {
      this.addToFolder(collection.items, parentId, folder);
    } else {
      collection.items.push(folder);
    }

    collection.updated = Date.now();
    await this.save();
    this.notify();
    return folder;
  }

  async importCollection(
    collection: Collection,
    requests: Array<PersistedJustRequest | JustRequest>
  ): Promise<void> {
    for (const req of requests) {
      if (req) {
        this.requests.set(req.id, normalizePersistedRequest(req));
      }
    }
    this.collections.push(collection);
    await this.save();
    this.notify();
  }

  private addRequestToFolder(items: CollectionItemRef[], folderId: string, requestId: string, name: string): boolean {
    for (const item of items) {
      if (item.type === 'folder' && item.id === folderId && item.items) {
        item.items.push({ type: 'request', id: requestId, name, requestId });
        return true;
      }
      if (item.type === 'folder' && item.items) {
        if (this.addRequestToFolder(item.items, folderId, requestId, name)) { return true; }
      }
    }
    return false;
  }

  private addToFolder(items: CollectionItemRef[], folderId: string, newItem: CollectionItemRef): boolean {
    for (const item of items) {
      if (item.type === 'folder' && item.id === folderId && item.items) {
        item.items.push(newItem);
        return true;
      }
      if (item.type === 'folder' && item.items) {
        if (this.addToFolder(item.items, folderId, newItem)) { return true; }
      }
    }
    return false;
  }

  private extractItem(items: CollectionItemRef[], itemId: string): CollectionItemRef | null {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === itemId) {
        return items.splice(i, 1)[0];
      }
      if (items[i].type === 'folder' && items[i].items) {
        const found = this.extractItem(items[i].items!, itemId);
        if (found) { return found; }
      }
    }
    return null;
  }

  private removeItem(items: CollectionItemRef[], itemId: string): boolean {
    const idx = items.findIndex(i => i.id === itemId || (i.type === 'request' && i.requestId === itemId));
    if (idx >= 0) {
      items.splice(idx, 1);
      return true;
    }
    for (const item of items) {
      if (item.type === 'folder' && item.items) {
        if (this.removeItem(item.items, itemId)) { return true; }
      }
    }
    return false;
  }
}
