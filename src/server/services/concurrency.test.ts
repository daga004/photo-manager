import { describe, expect, test } from "bun:test";
import { runWithConcurrency, Semaphore } from "./concurrency.ts";

describe("runWithConcurrency", () => {
  test("runs every item and preserves result order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (n) => n * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  test("never exceeds the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await runWithConcurrency(items, 3, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});

describe("Semaphore", () => {
  test("never allows more than `limit` concurrent holders, even under heavy contention", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let maxActive = 0;

    async function task(): Promise<void> {
      const release = await sem.acquire();
      active++;
      maxActive = Math.max(maxActive, active);
      // Yield without a real timer, to maximize the chance of exposing a
      // release/acquire handoff race if one exists.
      await Promise.resolve();
      active--;
      release();
    }

    await Promise.all(Array.from({ length: 50 }, () => task()));
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(active).toBe(0);
  });

  test("queued waiters eventually all run", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    async function task(n: number): Promise<void> {
      const release = await sem.acquire();
      order.push(n);
      release();
    }
    await Promise.all([1, 2, 3, 4, 5].map((n) => task(n)));
    expect(order.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});
