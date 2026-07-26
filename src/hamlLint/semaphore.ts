// A counting semaphore. Pure; no vscode imports.
//
// Extracted from the process runner so its own contract - acquire resolves in FIFO order, release is
// idempotent - can be asserted without spawning anything.

export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  /** Resolves to a release function. Calling it more than once is a no-op, not a double release. */
  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++;
    } else {
      // The releaser hands its slot over without decrementing, so `active` never dips in between:
      // a decrement-then-wake gap would let a synchronous acquire barge past the queue and push
      // admission over the limit once the woken waiter incremented again.
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.waiting.shift();
      if (next === undefined) {
        this.active--;
      } else {
        next();
      }
    };
  }
}
