export type StartupActionDelivery<T> = (
  operationId: string,
  action: T
) => Promise<boolean>;

interface PendingAction<T> {
  action: T;
  delivered: boolean;
  generation?: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export class StartupActionQueue<T> {
  private readonly pending = new Map<string, PendingAction<T>>();
  private ready = false;
  private flushing = false;
  private disposed = false;
  private generation = 0;

  constructor(
    private readonly deliver: StartupActionDelivery<T>,
    private readonly acknowledgementTimeoutMs = 15_000
  ) {}

  enqueue(operationId: string, action: T): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('The startup action queue has been disposed.'));
    }
    if (this.pending.has(operationId)) {
      return Promise.reject(new Error('The startup action operation identifier is already pending.'));
    }

    const completion = new Promise<void>((resolve, reject) => {
      this.pending.set(operationId, { action, delivered: false, resolve, reject });
    });
    this.flush();
    return completion;
  }

  setReady(ready: boolean): void {
    if (this.disposed) {
      return;
    }
    this.ready = ready;
    this.flush();
  }

  resetForNewTarget(): void {
    if (this.disposed) {
      return;
    }
    this.generation += 1;
    this.ready = false;
    for (const pending of this.pending.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
        pending.timeout = undefined;
      }
      pending.delivered = false;
      pending.generation = undefined;
    }
  }

  complete(operationId: string): boolean {
    const pending = this.pending.get(operationId);
    if (!pending || !pending.delivered) {
      return false;
    }
    this.pending.delete(operationId);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    pending.resolve();
    return true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.ready = false;
    for (const pending of this.pending.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error('The extension was disposed before the startup action completed.'));
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private flush(): void {
    if (!this.ready || this.flushing || this.disposed) {
      return;
    }
    this.flushing = true;
    void this.flushPending();
  }

  private async flushPending(): Promise<void> {
    try {
      for (const [operationId, pending] of this.pending) {
        if (!this.ready || this.disposed) {
          break;
        }
        if (pending.delivered) {
          continue;
        }
        const deliveryGeneration = this.generation;
        pending.delivered = true;
        pending.generation = deliveryGeneration;
        try {
          const delivered = await this.deliver(operationId, pending.action);
          if (!this.pending.has(operationId)
            || pending.generation !== deliveryGeneration) {
            continue;
          }
          if (!delivered) {
            this.fail(operationId, 'The webview rejected the startup action.');
            continue;
          }
          pending.timeout = setTimeout(() => {
            this.fail(operationId, 'The webview did not acknowledge the startup action in time.');
          }, this.acknowledgementTimeoutMs);
        } catch {
          if (pending.generation === deliveryGeneration) {
            this.fail(operationId, 'The startup action could not be delivered to the webview.');
          }
        }
      }
    } finally {
      this.flushing = false;
      if (this.ready && !this.disposed
        && Array.from(this.pending.values()).some(pending => !pending.delivered)) {
        this.flush();
      }
    }
  }

  private fail(operationId: string, message: string): void {
    const pending = this.pending.get(operationId);
    if (!pending) {
      return;
    }
    this.pending.delete(operationId);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    pending.reject(new Error(message));
  }
}
