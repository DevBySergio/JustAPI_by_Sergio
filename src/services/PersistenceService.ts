import { Variable } from '../models/Variable';
import { DataStore } from './DataStore';

export class PersistenceService {
  constructor(
    private readonly variablesStore: DataStore,
    private readonly settingsStore: DataStore
  ) {}

  async loadVariables(): Promise<Variable[]> {
    return await this.variablesStore.read<Variable[]>('globalVariables') ?? [];
  }

  async saveVariables(variables: Variable[]): Promise<void> {
    await this.variablesStore.write('globalVariables', variables);
  }

  async loadSettings(): Promise<Record<string, unknown>> {
    return await this.settingsStore.read<Record<string, unknown>>('settings') ?? {};
  }

  async saveSettings(settings: Record<string, unknown>): Promise<void> {
    await this.settingsStore.write('settings', settings);
  }
}
