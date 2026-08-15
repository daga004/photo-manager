import type { ActiveTransfer, JobProgress } from "../../shared/types.ts";

/**
 * In-memory, high-frequency live-progress store for RUNNING import jobs. This
 * is deliberately NOT persisted: the numbers churn many times per second as
 * bytes stream in, they're only meaningful while a job is actively copying, and
 * a lost snapshot after a restart is harmless (the DB counters remain the
 * durable record). The jobs route reads a `snapshot(jobId)` and merges it into
 * the `ImportJobRecord` it returns; nothing else observes this state.
 *
 * All access happens on Bun's single event-loop thread — startTransfer/addBytes/
 * finishTransfer are called from the import executor, snapshot from an HTTP
 * handler, and none of them `await` mid-mutation — so there is no interleaving
 * and no locking is required. `Date.now()` is used purely for rate timing; this
 * is application code (only workflow scripts are barred from wall-clock time).
 */

/** Rolling window over which throughput is averaged. Long enough to smooth out
 * the burstiness of chunked stream writes, short enough to react to a slow file. */
const RATE_WINDOW_MS = 4000;

interface JobState {
  /** Live transfers keyed by their transferId. The public `activeTransfers`
   * array is rebuilt from these on each snapshot. */
  transfers: Map<number, ActiveTransfer>;
  nextTransferId: number;
  bytesCopiedTotal: number;
  bytesPerSecond: number;
  lastCompletedFilename: string | null;
  lastCompletedMediaId: number | null;
  /** (timestampMs, cumulativeBytes) samples within the rolling window, for rate. */
  samples: Array<{ t: number; bytes: number }>;
}

const jobs = new Map<number, JobState>();

/** Begins tracking a job. Idempotent-ish: resets any prior state for the id so
 * a resumed run starts from a clean, zeroed progress snapshot. */
export function initJob(jobId: number): void {
  jobs.set(jobId, {
    transfers: new Map(),
    nextTransferId: 1,
    bytesCopiedTotal: 0,
    bytesPerSecond: 0,
    lastCompletedFilename: null,
    lastCompletedMediaId: null,
    samples: [],
  });
}

/** Stops tracking a job and frees its state. Called when a run ends (complete,
 * pause, or fail) — a finished job reports no live progress. */
export function clearJob(jobId: number): void {
  jobs.delete(jobId);
}

/**
 * Records the start of a single file transfer and returns its transferId. Lazily
 * initializes the job's state if it somehow wasn't (defensive — the executor
 * always calls initJob first), so a transfer is never silently dropped.
 *
 * `destRelativeDir` is the `photos|videos/YYYY/MM/DD` destination folder; it's
 * stored on the transfer so the UI can show the capture-date folders live.
 */
export function startTransfer(jobId: number, filename: string, sizeBytes: number, destRelativeDir: string): number {
  let state = jobs.get(jobId);
  if (!state) {
    initJob(jobId);
    state = jobs.get(jobId) as JobState;
  }
  const transferId = state.nextTransferId++;
  state.transfers.set(transferId, {
    filename,
    destRelativeDir,
    sizeBytes,
    bytesCopied: 0,
    startedAt: new Date().toISOString(),
  });
  return transferId;
}

/**
 * Adds `n` freshly-copied bytes to a transfer and to the job total, then
 * recomputes the smoothed throughput over the rolling window. No-op if the job
 * or transfer is unknown (e.g. a late callback after finishTransfer).
 */
export function addBytes(jobId: number, transferId: number, n: number): void {
  const state = jobs.get(jobId);
  if (!state) return;
  const transfer = state.transfers.get(transferId);
  if (!transfer) return;

  transfer.bytesCopied += n;
  state.bytesCopiedTotal += n;

  const now = Date.now();
  state.samples.push({ t: now, bytes: state.bytesCopiedTotal });
  // Drop samples older than the window, but keep the last one that falls just
  // outside it as the window's lower boundary so the rate spans the full window.
  const cutoff = now - RATE_WINDOW_MS;
  let firstInWindow = 0;
  while (firstInWindow < state.samples.length - 1 && (state.samples[firstInWindow + 1] as { t: number }).t < cutoff) {
    firstInWindow++;
  }
  if (firstInWindow > 0) state.samples.splice(0, firstInWindow);

  const oldest = state.samples[0] as { t: number; bytes: number };
  const newest = state.samples[state.samples.length - 1] as { t: number; bytes: number };
  const dtMs = newest.t - oldest.t;
  state.bytesPerSecond = dtMs > 0 ? ((newest.bytes - oldest.bytes) / dtMs) * 1000 : 0;
}

/**
 * Marks a transfer finished and removes it from the active list. When `mediaId`
 * is set (a real import, not a duplicate/error), records it as the most-recently
 * completed file so the UI can show a "just imported" preview thumbnail.
 */
export function finishTransfer(jobId: number, transferId: number, mediaId: number | null, filename: string): void {
  const state = jobs.get(jobId);
  if (!state) return;
  state.transfers.delete(transferId);
  if (mediaId !== null) {
    state.lastCompletedFilename = filename;
    state.lastCompletedMediaId = mediaId;
  }
}

/** Builds a fresh, read-only progress snapshot for the jobs route. Returns null
 * for jobs that aren't being tracked (idle/finished/never-started). */
export function snapshot(jobId: number): JobProgress | null {
  const state = jobs.get(jobId);
  if (!state) return null;
  return {
    activeTransfers: Array.from(state.transfers.values(), (t) => ({ ...t })),
    bytesCopiedTotal: state.bytesCopiedTotal,
    bytesPerSecond: state.bytesPerSecond,
    lastCompletedFilename: state.lastCompletedFilename,
    lastCompletedMediaId: state.lastCompletedMediaId,
    updatedAt: new Date().toISOString(),
  };
}
