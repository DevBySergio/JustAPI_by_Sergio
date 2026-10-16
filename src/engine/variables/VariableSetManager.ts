import { VariableSet, createDefaultVariableSet } from '../../models/VariableSet';
import { randomUUID } from 'node:crypto';
import { Variable } from '../../models/Variable';
import { DataStore } from '../../services/DataStore';
import { SerialQueue } from '../../utils/SerialQueue';
import { validateExtensionMessage } from '../../protocol/MessageValidator';
import { ApplicationError } from '../../services/ApplicationError';

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
      const sets = clone(await this.store.read<VariableSet[]>('variableSets') ?? []);
      this.validate(sets); this.sets = sets;
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
    return this.getByCollectionId(collectionId).filter(set => set.kind !== 'environment').flatMap(set => set.variables);
  }

  getActiveEnvironment(): VariableSet | undefined { return this.getAll().find(set => set.kind === 'environment' && set.active); }

  async selectEnvironment(id: string | null): Promise<void> {
    return this.operations.run(async () => {
      const sets = this.getAll();
      if (id !== null && !sets.some(set => set.id === id && set.kind === 'environment')) { throw new Error('Environment not found.'); }
      for (const set of sets.filter(value => value.kind === 'environment')) {
        if (Boolean(set.active) !== (set.id === id)) { set.active = set.id === id; set.updated = Math.max(Date.now(), set.updated + 1); }
      }
      await this.commit(sets);
    });
  }

  async create(name: string, kind?: 'environment', variables: Variable[] = []): Promise<VariableSet> {
    return this.operations.run(async () => {
      const set = { ...createDefaultVariableSet(name, randomUUID()), variables: clone(variables), ...(kind ? { kind, active: false } : {}) };
      await this.commit([...this.getAll(), set]);
      return clone(set);
    });
  }

  async update(updated: VariableSet): Promise<void> {
    const snapshot = clone(updated);
    return this.mutate(snapshot.id, set => {
      if (set.kind === 'environment' && set.updated !== snapshot.updated) { throw new ApplicationError('OPERATION_FAILED', ['The environment changed. Reopen it before saving your edits.']); }
      Object.assign(set, { name: snapshot.name, variables: snapshot.variables, linkedCollectionIds: set.kind === 'environment' ? [] : snapshot.linkedCollectionIds });
    });
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
      set.updated = Math.max(Date.now(), set.updated + 1);
      await this.commit(sets);
    });
  }

  private async commit(sets: VariableSet[]): Promise<void> {
    this.validate(sets);
    await this.store.write('variableSets', sets);
    this.sets = sets;
    this.onDidChange?.();
  }

  private validate(sets: VariableSet[]): void {
    if (!validateExtensionMessage({ type: 'variableSets', operationId: 'validate-variable-sets', sets }).ok
      || new Set(sets.map(set => set.id)).size !== sets.length
      || sets.filter(set => set.kind === 'environment' && set.active).length > 1) {
      throw new Error('Invalid variable sets or environment selection.');
    }
  }
}
