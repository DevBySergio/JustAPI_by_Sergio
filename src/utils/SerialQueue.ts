/** Serialize the entire transaction, including reads and publication of committed state. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) { return Promise.reject(new Error('The operation queue has been closed.')); }
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.tail;
  }
}
