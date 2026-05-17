import { VariableSet, createDefaultVariableSet } from '../../models/VariableSet';
import { Variable } from '../../models/Variable';
import { JsonFileStore } from '../../storage/JsonFileStore';

export class VariableSetManager {
  private sets: VariableSet[] = [];
  private store: JsonFileStore;
  private onDidChange: (() => void) | null = null;

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  setOnDidChange(cb: () => void): void {
    this.onDidChange = cb;
  }

  private notify(): void {
    this.onDidChange?.();
  }

  async load(): Promise<void> {
    const data = await this.store.read<VariableSet[]>('variableSets');
    if (data) {
      this.sets = data;
    }
  }

  async save(): Promise<void> {
    await this.store.write('variableSets', this.sets);
  }

  getAll(): VariableSet[] {
    return this.sets;
  }

  getById(id: string): VariableSet | undefined {
    return this.sets.find(s => s.id === id);
  }

  getByCollectionId(collectionId: string): VariableSet[] {
    return this.sets.filter(s => s.linkedCollectionIds.includes(collectionId));
  }

  /** Returns combined variables from all variable sets linked to a collection */
  getVariablesForCollection(collectionId: string): Variable[] {
    const sets = this.getByCollectionId(collectionId);
    const seen = new Set<string>();
    const result: Variable[] = [];
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

  async create(name: string): Promise<VariableSet> {
    const set = createDefaultVariableSet(name);
    this.sets.push(set);
    await this.save();
    this.notify();
    return set;
  }

  async update(updated: VariableSet): Promise<void> {
    const idx = this.sets.findIndex(s => s.id === updated.id);
    if (idx >= 0) {
      updated.updated = Date.now();
      this.sets[idx] = updated;
      await this.save();
      this.notify();
    }
  }

  async delete(id: string): Promise<void> {
    this.sets = this.sets.filter(s => s.id !== id);
    await this.save();
    this.notify();
  }

  async linkToCollection(setId: string, collectionId: string): Promise<void> {
    const set = this.sets.find(s => s.id === setId);
    if (set && !set.linkedCollectionIds.includes(collectionId)) {
      set.linkedCollectionIds.push(collectionId);
      set.updated = Date.now();
      await this.save();
      this.notify();
    }
  }

  async unlinkFromCollection(setId: string, collectionId: string): Promise<void> {
    const set = this.sets.find(s => s.id === setId);
    if (set) {
      set.linkedCollectionIds = set.linkedCollectionIds.filter(id => id !== collectionId);
      set.updated = Date.now();
      await this.save();
      this.notify();
    }
  }
}
