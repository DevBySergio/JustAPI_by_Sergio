export interface CancellableExecution {
  cancel(): void;
}

export interface ExecutionEntry {
  operationId: string;
  executionId: string;
  client: CancellableExecution;
  cancelled: boolean;
}

const DEFAULT_RECENT_LIMIT = 1_000;

export class OperationRegistry {
  private readonly seen = new Map<string, number>();

  constructor(private readonly recentLimit = DEFAULT_RECENT_LIMIT) {}

  claim(operationId: string): boolean {
    if (this.seen.has(operationId)) {
      return false;
    }
    this.seen.set(operationId, Date.now());
    this.prune();
    return true;
  }

  private prune(): void {
    while (this.seen.size > this.recentLimit) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (oldest === undefined) {
        return;
      }
      this.seen.delete(oldest);
    }
  }
}

export class ExecutionRegistry {
  private readonly active = new Map<string, ExecutionEntry>();
  private readonly completed = new Set<string>();

  constructor(private readonly recentLimit = DEFAULT_RECENT_LIMIT) {}

  register(operationId: string, executionId: string, client: CancellableExecution): ExecutionEntry | null {
    if (this.active.has(executionId) || this.completed.has(executionId)) {
      return null;
    }
    const entry: ExecutionEntry = {
      operationId,
      executionId,
      client,
      cancelled: false,
    };
    this.active.set(executionId, entry);
    return entry;
  }

  get(executionId: string): ExecutionEntry | undefined {
    return this.active.get(executionId);
  }

  cancel(executionId: string): ExecutionEntry | undefined {
    const entry = this.active.get(executionId);
    if (!entry) {
      return undefined;
    }
    entry.cancelled = true;
    entry.client.cancel();
    return entry;
  }

  complete(executionId: string): ExecutionEntry | undefined {
    const entry = this.active.get(executionId);
    if (!entry) {
      return undefined;
    }
    this.active.delete(executionId);
    this.completed.add(executionId);
    while (this.completed.size > this.recentLimit) {
      const oldest = this.completed.values().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.completed.delete(oldest);
    }
    return entry;
  }

  cancelAll(): void {
    for (const entry of this.active.values()) {
      entry.cancelled = true;
      entry.client.cancel();
    }
    this.active.clear();
  }
}
