import { VariableSet, createDefaultVariableSet } from '../../models/VariableSet';
import { Variable } from '../../models/Variable';
import { DataStore } from '../../services/DataStore';
import { SerialQueue } from '../../utils/SerialQueue';

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export class VariableSetManager {
  private sets: VariableSet[] = [];
  private readonly operations = new SerialQueue();
  private onDidChange: (() => void) | null = null;

  constructor(private readonly store: DataStore) {}

  async dispose(): Promise<void> { await this.operations.close(); }

  setOnDidChange(cb: () => void): void { this.onDidChange = cb; }

  async load(): Promise<void> {
    return this.operations.run(async () => {
      this.sets = clone(await this.store.read<VariableSet[]>('variableSets') ?? []);
    });
  }

  async save(): Promise<void> {
    return this.operations.run(async () => { await this.store.write('variableSets', this.sets); });
  }

  getAll(): VariableSet[] { return clone(this.sets); }

  getById(id: string): VariableSet | undefined {
    const set = this.sets.find(value => value.id === id);
    return set ? clone(set) : undefined;
  }

  getByCollectionId(collectionId: string): VariableSet[] {
    return this.getAll().filter(set => set.linkedCollectionIds.includes(collectionId));
  }

  getVariablesForCollection(collectionId: string): Variable[] {
    return this.getByCollectionId(collectionId).flatMap(set => set.variables);
  }

  async create(name: string): Promise<VariableSet> {
    return this.operations.run(async () => {
      const set = createDefaultVariableSet(name);
      await this.commit([...this.getAll(), set]);
      return clone(set);
    });
  }

  async update(updated: VariableSet): Promise<void> {
    const snapshot = clone(updated);
    return this.mutate(snapshot.id, set => Object.assign(set, snapshot));
  }

  async delete(id: string): Promise<void> {
    return this.operations.run(async () => {
      await this.commit(this.getAll().filter(set => set.id !== id));
    });
  }

  async linkToCollection(setId: string, collectionId: string): Promise<void> {
    return this.mutate(setId, set => {
      if (!set.linkedCollectionIds.includes(collectionId)) { set.linkedCollectionIds.push(collectionId); }
    });
  }

  async unlinkFromCollection(setId: string, collectionId: string): Promise<void> {
    return this.mutate(setId, set => {
      set.linkedCollectionIds = set.linkedCollectionIds.filter(id => id !== collectionId);
    });
  }

  private async mutate(id: string, change: (set: VariableSet) => void): Promise<void> {
    return this.operations.run(async () => {
      const sets = this.getAll();
      const set = sets.find(value => value.id === id);
      if (!set) { throw new Error('Variable set not found'); }
      change(set);
      set.updated = Date.now();
      await this.commit(sets);
    });
  }

  private async commit(sets: VariableSet[]): Promise<void> {
    await this.store.write('variableSets', sets);
    this.sets = sets;
    this.onDidChange?.();
  }
}
