/**
 * AsyncMutex ensures strict mutual exclusion for async operations (such as queue drain loops).
 * Guarantees FIFO acquisition order, safe release, and prevents concurrent drain executions.
 */
export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  public async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = this.queue.shift();
        if (next) {
          next();
        } else {
          this.locked = false;
        }
      };
    }

    return new Promise<() => void>(resolve => {
      this.queue.push(() => {
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          const next = this.queue.shift();
          if (next) {
            next();
          } else {
            this.locked = false;
          }
        });
      });
    });
  }

  public get isLocked(): boolean {
    return this.locked;
  }
}
