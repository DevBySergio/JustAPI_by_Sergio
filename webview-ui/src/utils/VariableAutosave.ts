import type { Collection } from '../../../src/models/Collection';
import type { Variable } from '../../../src/models/Variable';
import type { WebviewMessageInput } from './vscodeApi';

type Save = Extract<WebviewMessageInput, { type: 'setGlobalVariables' | 'setCollectionVariables' }>;

/** Owned by App, so switching variable panels cannot cancel pending edits. */
export class VariableAutosave {
  private pending = new Map<string, Save>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;

  constructor(
    private readonly send: (message: Save) => Promise<void>,
    private readonly onError: (error: unknown) => void
  ) {}

  scheduleGlobal(variables: Variable[]): void {
    this.schedule('global', { type: 'setGlobalVariables', variables });
  }

  scheduleCollection(collectionId: string, variables: Variable[]): void {
    this.schedule(`collection:${collectionId}`, { type: 'setCollectionVariables', collectionId, variables });
  }

  overlayCollections(collections: Collection[]): Collection[] {
    return collections.map(collection => {
      const pending = this.pending.get(`collection:${collection.id}`);
      return pending?.type === 'setCollectionVariables'
        ? { ...collection, variables: pending.variables }
        : collection;
    });
  }

  overlayGlobal(variables: Variable[]): Variable[] {
    const pending = this.pending.get('global');
    return pending?.type === 'setGlobalVariables' ? pending.variables : variables;
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running) { return this.running; }
    this.running = this.drain().finally(() => { this.running = undefined; });
    return this.running;
  }

  private schedule(key: string, message: Save): void {
    this.pending.set(key, JSON.parse(JSON.stringify(message)) as Save);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(this.onError); }, 500);
  }

  private async drain(): Promise<void> {
    while (this.pending.size > 0) {
      for (const [key, message] of this.pending) {
        await this.send(message);
        if (this.pending.get(key) === message) { this.pending.delete(key); }
      }
    }
  }
}
