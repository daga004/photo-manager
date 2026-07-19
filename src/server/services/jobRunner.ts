import { Database } from "bun:sqlite";
import { createImportJob, findActiveJob, getImportJob, updateImportJob } from "../db.ts";
import { runImportJob } from "./importJob.ts";
import { runReindexJob } from "./reindexJob.ts";
import { runDeviceImportJob } from "./deviceImportJob.ts";

/**
 * Bun is single-threaded, but these jobs are I/O-bound (subprocess spawns,
 * file copies, network/SMB reads) and yield control on every await — a
 * fire-and-forget async function updating its `import_jobs` row as it
 * progresses is sufficient for v1, no worker thread needed. The HTTP route
 * that calls these returns the jobId immediately; the client polls
 * GET /api/jobs/:jobId for progress.
 *
 * Only one job may run at a time (see db.ts's findActiveJob doc comment) —
 * confirmed empirically that overlapping jobs can race each other, both for
 * device-import (two sessions against the same phone) and for import/reindex
 * (collision resolution reads-then-writes a destination directory).
 */

type StartResult = { ok: true; jobId: number } | { ok: false; error: string };

function guardNoActiveJob(db: Database): { ok: true } | { ok: false; error: string } {
  const active = findActiveJob(db);
  if (active) {
    return {
      ok: false,
      error: `Job #${active.id} (${active.jobType}) is already ${active.status} — only one job can run at a time. Wait for it to finish, or stop/resume it, before starting another.`,
    };
  }
  return { ok: true };
}

export function startImportJob(db: Database, sourcePath: string): StartResult {
  const guard = guardNoActiveJob(db);
  if (!guard.ok) return guard;

  const jobId = createImportJob(db, { jobType: "import", sourcePath });
  void runImportJob(db, jobId, sourcePath).catch((err) => logUnhandled(jobId, err));
  return { ok: true, jobId };
}

export function startReindexJob(db: Database): StartResult {
  const guard = guardNoActiveJob(db);
  if (!guard.ok) return guard;

  const jobId = createImportJob(db, { jobType: "reindex" });
  void runReindexJob(db, jobId).catch((err) => logUnhandled(jobId, err));
  return { ok: true, jobId };
}

export function startDeviceImportJob(
  db: Database,
  udid: string,
  deviceName: string,
  deleteAfterVerify: boolean,
): StartResult {
  const guard = guardNoActiveJob(db);
  if (!guard.ok) return guard;

  const jobId = createImportJob(db, {
    jobType: "device_import",
    deviceUdid: udid,
    deviceName,
    deleteAfterVerify,
  });
  void runDeviceImportJob(db, jobId, udid, deleteAfterVerify).catch((err) => logUnhandled(jobId, err));
  return { ok: true, jobId };
}

/**
 * Resumes a `stalled` or `failed` job by re-invoking its run function
 * against the SAME jobId — every run function is written to pick up from
 * persisted per-file/per-item state rather than starting over, so this is
 * just "run it again."
 */
export function resumeJob(db: Database, jobId: number): { ok: true } | { ok: false; error: string } {
  const job = getImportJob(db, jobId);
  if (!job) return { ok: false, error: `No such job: ${jobId}` };
  if (job.status !== "stalled" && job.status !== "failed") {
    return { ok: false, error: `Job ${jobId} is '${job.status}', not resumable` };
  }

  const guard = guardNoActiveJob(db);
  if (!guard.ok) return guard;

  updateImportJob(db, jobId, { status: "running" });

  if (job.jobType === "import") {
    if (!job.sourcePath) return { ok: false, error: "import job missing sourcePath" };
    void runImportJob(db, jobId, job.sourcePath).catch((err) => logUnhandled(jobId, err));
  } else if (job.jobType === "reindex") {
    void runReindexJob(db, jobId).catch((err) => logUnhandled(jobId, err));
  } else {
    if (!job.deviceUdid) return { ok: false, error: "device_import job missing deviceUdid" };
    void runDeviceImportJob(db, jobId, job.deviceUdid, job.deleteAfterVerify).catch((err) =>
      logUnhandled(jobId, err),
    );
  }

  return { ok: true };
}

function logUnhandled(jobId: number, err: unknown): void {
  console.error(`[job ${jobId}] unhandled error`, err);
}
