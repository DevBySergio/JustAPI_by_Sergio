"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VariableSetManager = void 0;
const VariableSet_1 = require("../../models/VariableSet");
class VariableSetManager {
    sets = [];
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
        const data = await this.store.read('variableSets');
        if (data) {
            this.sets = data;
        }
    }
    async save() {
        await this.store.write('variableSets', this.sets);
    }
    getAll() {
        return this.sets;
    }
    getById(id) {
        return this.sets.find(s => s.id === id);
    }
    getByCollectionId(collectionId) {
        return this.sets.filter(s => s.linkedCollectionIds.includes(collectionId));
    }
    /** Returns combined variables from all variable sets linked to a collection */
    getVariablesForCollection(collectionId) {
        const sets = this.getByCollectionId(collectionId);
        const seen = new Set();
        const result = [];
        for (const set of sets) {
            for (const v of set.variables) {
                if (!seen.has(v.key)) {
                    seen.add(v.key);
                    result.push(v);
                }
            }
        }
        return result;
    }
    async create(name) {
        const set = (0, VariableSet_1.createDefaultVariableSet)(name);
        this.sets.push(set);
        await this.save();
        this.notify();
        return set;
    }
    async update(updated) {
        const idx = this.sets.findIndex(s => s.id === updated.id);
        if (idx >= 0) {
            updated.updated = Date.now();
            this.sets[idx] = updated;
            await this.save();
            this.notify();
        }
    }
    async delete(id) {
        this.sets = this.sets.filter(s => s.id !== id);
        await this.save();
        this.notify();
    }
    async linkToCollection(setId, collectionId) {
        const set = this.sets.find(s => s.id === setId);
        if (set && !set.linkedCollectionIds.includes(collectionId)) {
            set.linkedCollectionIds.push(collectionId);
            set.updated = Date.now();
            await this.save();
            this.notify();
        }
    }
    async unlinkFromCollection(setId, collectionId) {
        const set = this.sets.find(s => s.id === setId);
        if (set) {
            set.linkedCollectionIds = set.linkedCollectionIds.filter(id => id !== collectionId);
            set.updated = Date.now();
            await this.save();
            this.notify();
        }
    }
}
exports.VariableSetManager = VariableSetManager;
//# sourceMappingURL=VariableSetManager.js.map