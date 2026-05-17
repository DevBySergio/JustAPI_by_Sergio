"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectionManager = void 0;
const Collection_1 = require("../../models/Collection");
class CollectionManager {
    collections = [];
    requests = new Map();
    store;
    onDidChange = null;
    constructor(store) {
        this.store = store;
    }
    setOnDidChange(cb) {
        this.onDidChange = cb;
    }
    notify() {
        this.onDidChange?.();
    }
    async load() {
        const data = await this.store.read('collections');
        if (data) {
            this.collections = data.collections || [];
            if (data.requests) {
                for (const req of data.requests) {
                    this.requests.set(req.id, req);
                }
            }
        }
    }
    async save() {
        await this.store.write('collections', {
            collections: this.collections,
            requests: Array.from(this.requests.values()),
        });
    }
    getCollections() {
        return this.collections;
    }
    getCollection(id) {
        return this.collections.find(c => c.id === id);
    }
    async createCollection(name) {
        const collection = (0, Collection_1.createDefaultCollection)(name);
        this.collections.push(collection);
        await this.save();
        this.notify();
        return collection;
    }
    async updateCollection(collection) {
        const idx = this.collections.findIndex(c => c.id === collection.id);
        if (idx >= 0) {
            collection.updated = Date.now();
            this.collections[idx] = collection;
            await this.save();
            this.notify();
        }
    }
    async deleteCollection(id) {
        const collection = this.collections.find(c => c.id === id);
        if (collection) {
            this.collections = this.collections.filter(c => c.id !== id);
            await this.save();
            this.notify();
        }
    }
    async duplicateCollection(id) {
        const original = this.collections.find(c => c.id === id);
        if (!original)
            return undefined;
        const dup = JSON.parse(JSON.stringify(original));
        dup.id = crypto.randomUUID();
        dup.name = `${original.name} (Copy)`;
        dup.created = Date.now();
        dup.updated = Date.now();
        // Clone all requests belonging to this collection with new IDs
        const requestIdMap = new Map();
        const cloneItems = (items) => {
            for (const item of items) {
                if (item.type === 'request' && item.requestId) {
                    const originalReq = this.requests.get(item.requestId);
                    if (originalReq) {
                        const newReqId = crypto.randomUUID();
                        const clonedReq = { ...JSON.parse(JSON.stringify(originalReq)), id: newReqId, created: Date.now(), updated: Date.now() };
                        this.requests.set(newReqId, clonedReq);
                        requestIdMap.set(item.requestId, newReqId);
                        item.id = newReqId;
                        item.requestId = newReqId;
                    }
                }
                if (item.items) {
                    cloneItems(item.items);
                }
            }
        };
        cloneItems(dup.items);
        this.collections.push(dup);
        await this.save();
        this.notify();
        return dup;
    }
    getRequest(id) {
        return this.requests.get(id);
    }
    async saveRequest(request, collectionId, parentId) {
        request.updated = Date.now();
        this.requests.set(request.id, request);
        const collection = this.collections.find(c => c.id === collectionId);
        if (collection) {
            if (parentId) {
                this.addRequestToFolder(collection.items, parentId, request.id, request.name);
            }
            else {
                const existing = collection.items.find(i => i.type === 'request' && i.requestId === request.id);
                if (!existing) {
                    collection.items.push({
                        type: 'request',
                        id: request.id,
                        name: request.name,
                        requestId: request.id,
                    });
                }
            }
            collection.updated = Date.now();
        }
        await this.save();
        this.notify();
    }
    async deleteRequest(requestId, collectionId) {
        this.requests.delete(requestId);
        const collection = this.collections.find(c => c.id === collectionId);
        if (collection) {
            this.removeItem(collection.items, requestId);
            collection.updated = Date.now();
        }
        await this.save();
        this.notify();
    }
    async moveItem(itemId, sourceCollectionId, targetCollectionId, targetParentId) {
        const sourceCol = this.collections.find(c => c.id === sourceCollectionId);
        const targetCol = this.collections.find(c => c.id === targetCollectionId);
        if (!sourceCol || !targetCol)
            return;
        const item = this.extractItem(sourceCol.items, itemId);
        if (!item)
            return;
        if (targetParentId) {
            this.addToFolder(targetCol.items, targetParentId, item);
        }
        else {
            targetCol.items.push(item);
        }
        sourceCol.updated = Date.now();
        targetCol.updated = Date.now();
        await this.save();
        this.notify();
    }
    async addFolder(collectionId, name, parentId) {
        const collection = this.collections.find(c => c.id === collectionId);
        if (!collection)
            return undefined;
        const folder = {
            type: 'folder',
            id: crypto.randomUUID(),
            name,
            items: [],
        };
        if (parentId) {
            this.addToFolder(collection.items, parentId, folder);
        }
        else {
            collection.items.push(folder);
        }
        collection.updated = Date.now();
        await this.save();
        this.notify();
        return folder;
    }
    async importCollection(collection, requests) {
        for (const req of requests) {
            if (req) {
                this.requests.set(req.id, req);
            }
        }
        this.collections.push(collection);
        await this.save();
        this.notify();
    }
    addRequestToFolder(items, folderId, requestId, name) {
        for (const item of items) {
            if (item.type === 'folder' && item.id === folderId && item.items) {
                item.items.push({ type: 'request', id: requestId, name, requestId });
                return true;
            }
            if (item.type === 'folder' && item.items) {
                if (this.addRequestToFolder(item.items, folderId, requestId, name))
                    return true;
            }
        }
        return false;
    }
    addToFolder(items, folderId, newItem) {
        for (const item of items) {
            if (item.type === 'folder' && item.id === folderId && item.items) {
                item.items.push(newItem);
                return true;
            }
            if (item.type === 'folder' && item.items) {
                if (this.addToFolder(item.items, folderId, newItem))
                    return true;
            }
        }
        return false;
    }
    extractItem(items, itemId) {
        for (let i = 0; i < items.length; i++) {
            if (items[i].id === itemId) {
                return items.splice(i, 1)[0];
            }
            if (items[i].type === 'folder' && items[i].items) {
                const found = this.extractItem(items[i].items, itemId);
                if (found)
                    return found;
            }
        }
        return null;
    }
    removeItem(items, itemId) {
        const idx = items.findIndex(i => i.id === itemId || (i.type === 'request' && i.requestId === itemId));
        if (idx >= 0) {
            items.splice(idx, 1);
            return true;
        }
        for (const item of items) {
            if (item.type === 'folder' && item.items) {
                if (this.removeItem(item.items, itemId))
                    return true;
            }
        }
        return false;
    }
}
exports.CollectionManager = CollectionManager;
//# sourceMappingURL=CollectionManager.js.map