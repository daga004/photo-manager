/**
 * Cooperative pause signalling for long-running jobs. A running job checks
 * `isPauseRequested(jobId)` at safe checkpoints (e.g. between chunks, where all
 * work so far is already persisted) and, if set, stops cleanly and marks itself
 * 'paused'. Resuming re-runs the job, which picks up from persisted state.
 *
 * This is in-process state: the job loop and the HTTP pause handler run in the
 * same server process, so a plain module-level Set is all that's needed. A
 * `paused` row surviving a process restart is reconciled to 'stalled' at
 * startup (same recovery path as an interrupted job), and is equally resumable.
 */
const pauseRequested = new Set<number>();

export function requestPause(jobId: number): void {
  pauseRequested.add(jobId);
}

export function isPauseRequested(jobId: number): boolean {
  return pauseRequested.has(jobId);
}

/** Clear any stale pause request for a job about to (re)start running. */
export function clearPause(jobId: number): void {
  pauseRequested.delete(jobId);
}

/** Thrown by a job's checkpoint helper to unwind cleanly to the paused state. */
export class JobPausedError extends Error {
  constructor(jobId: number) {
    super(`Job ${jobId} paused`);
    this.name = "JobPausedError";
  }
}
