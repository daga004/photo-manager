/**
 * Yields control back to the event loop's macrotask phase (new HTTP
 * connections, timers, etc.), not just the microtask queue. This matters:
 * confirmed empirically that a tight Promise.all-driven loop of awaits that
 * each resolve in well under a second (e.g. hashing many small files) can
 * starve Bun's HTTP server for the loop's ENTIRE duration — a plain `await`
 * only drains microtasks, and JS runs the whole microtask queue to empty
 * before ever touching the macrotask queue where incoming connections live.
 * `setTimeout` is a real macrotask, so awaiting one forces a genuine yield.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Runs `worker` over `items` with at most `limit` concurrent invocations.
 * No external dependency needed for a pool this small. Yields to the event
 * loop after every item so a long batch never starves concurrent HTTP
 * request handling (see yieldToEventLoop's note above).
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    for (;;) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await worker(items[current] as T, current);
      await yieldToEventLoop();
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}

/**
 * A counting semaphore for capping concurrent work triggered by independent
 * incoming requests (e.g. thumbnail generation), as opposed to
 * `runWithConcurrency`'s fixed batch-of-known-items shape.
 */
export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    this.available = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return () => this.release();
    }
    // No free slot: wait to be woken by a release(). The waiter that wakes us
    // is handing its slot directly to us (see release()), so no counter
    // change happens here — doing so would race a concurrent acquire() that
    // observes `available` between release()'s increment and this resuming.
    await new Promise<void>((resolve) => this.queue.push(resolve));
    return () => this.release();
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // Hand the slot directly to the next waiter; `available` is unchanged
      // since the slot never actually became free.
      next();
    } else {
      this.available++;
    }
  }
}
