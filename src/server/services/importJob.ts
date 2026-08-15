import { Database } from "bun:sqlite";
import { basename, join } from "node:path";
import {
  getImportJob,
  incrementImportJobCounters,
  insertMedia,
  logImportJobEvent,
  updateImportJob,
} from "../db.ts";
import { config, getLibraryRoot } from "../config.ts";
import { COPY_CONCURRENCY, HASH_CONCURRENCY, LARGE_FILE_BYTES, LARGE_FILE_CONCURRENCY } from "../../shared/constants.ts";
import { baseNameNoExt } from "../../shared/extensions.ts";
import { scanDirectory } from "./scanner.ts";
import { batchExtractMetadata } from "./exif.ts";
import { sampledFingerprint } from "./hash.ts";
import { safeMoveFile, safeMoveFileStreamed } from "./fsmove.ts";
import { runWithConcurrency, Semaphore, yieldToEventLoop } from "./concurrency.ts";
import { buildImportPlan, type PlanFileInput, type PlannedOp } from "./importPlanner.ts";
import { isPauseRequested } from "./jobControl.ts";
import { clearJob, finishTransfer, initJob, startTransfer, addBytes } from "./jobProgress.ts";

/** Files fingerprinted + placed per chunk. Chunking makes progress track the
 * SLOW placement step (not the fast fingerprint), bounds pause-discarded work,
 * and lets the user pause mid-import. */
const IMPORT_CHUNK_SIZE = 100;

/**
 * Imports every media file found (recursively) under `sourcePath` into the
 * library, organized as photos|videos/YYYY/MM/DD/. Files whose content already
 * exists elsewhere in the library are quarantined (not physically duplicated)
 * rather than copied in.
 *
 * Each chunk runs as PLAN then EXECUTE:
 *   - Phase 1 (fast): fingerprint the chunk concurrently and extract metadata.
 *   - PLAN: `buildImportPlan` decides every file's fate — a unique destination
 *     name for each genuine import (all names reserved up front), quarantine for
 *     library duplicates, skip for in-batch duplicates.
 *   - EXECUTE (slow): move files into the library with bounded, size-aware
 *     CONCURRENCY, reporting live per-file transfer progress. Because all
 *     destination names were reserved in the plan pass, parallel moves can no
 *     longer race on filename allocation — which is exactly why the old code had
 *     to place files strictly sequentially.
 *
 * filesProcessed is bumped during fingerprinting; the terminal counters
 * (imported/skipped/errored) are bumped as files are actually moved, so the
 * progress bar reflects the real end-to-end copy work, not the fast fingerprint.
 */
export async function runImportJob(db: Database, jobId: number, sourcePath: string): Promise<void> {
  initJob(jobId);
  try {
    const scanned = await scanDirectory(sourcePath);
    // filesFound is only set on the FIRST run: a resume re-scans the source
    // folder, which naturally shrinks as already-imported files are moved out
    // of it — overwriting filesFound on every resume would make it drift while
    // filesProcessed keeps climbing.
    const existingJob = getImportJob(db, jobId);
    if (!existingJob || existingJob.filesFound === 0) {
      updateImportJob(db, jobId, { filesFound: scanned.length });
    }

    if (scanned.length === 0) {
      updateImportJob(db, jobId, { status: "completed", finishedAt: new Date().toISOString() });
      return;
    }

    for (let start = 0; start < scanned.length; start += IMPORT_CHUNK_SIZE) {
      // Pause checkpoint between chunks — every prior chunk's files are already
      // moved + indexed, so pausing here never loses committed work.
      if (isPauseRequested(jobId)) {
        updateImportJob(db, jobId, { status: "paused" });
        return;
      }

      const chunk = scanned.slice(start, start + IMPORT_CHUNK_SIZE);

      // Phase 1 (fast): fingerprint the chunk. filesProcessed tracks this
      // indexing step — it's the ~128KB-per-file read, quick even over a share.
      const hashes = await runWithConcurrency(chunk, HASH_CONCURRENCY, async (f) => {
        const h = await sampledFingerprint(f.absolutePath);
        incrementImportJobCounters(db, jobId, { filesProcessed: 1 });
        return h;
      });
      const metaMap = await batchExtractMetadata(chunk.map((f) => f.absolutePath));

      // PLAN: resolve dates, dedup status, and every destination name up front.
      const planInputs: PlanFileInput[] = chunk.map((file, i) => ({
        file,
        fingerprint: hashes[i] as string,
        meta: metaMap.get(file.absolutePath),
      }));
      const ops = await buildImportPlan(db, planInputs);

      // EXECUTE: move files with bounded, size-aware concurrency. Returns early
      // (paused=true) if a pause was requested mid-chunk; already-executed ops
      // are durable and the rest is re-scanned cheaply on resume.
      const { paused } = await executePlan(db, jobId, ops);
      if (paused) {
        updateImportJob(db, jobId, { status: "paused" });
        return;
      }
    }

    updateImportJob(db, jobId, { status: "completed", finishedAt: new Date().toISOString() });
  } catch (err) {
    updateImportJob(db, jobId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      lastError: err instanceof Error ? err.message : String(err),
    });
  } finally {
    // Live progress is only meaningful while running; drop it on any exit.
    clearJob(jobId);
  }
}

/**
 * Executes a chunk's planned ops with bounded, size-aware concurrency.
 *
 * Two semaphores enforce the limits (see COPY_CONCURRENCY / LARGE_FILE_*):
 *   - a GLOBAL semaphore sized COPY_CONCURRENCY caps total in-flight ops;
 *   - a LARGE semaphore sized LARGE_FILE_CONCURRENCY additionally caps how many
 *     large (>= LARGE_FILE_BYTES) files copy at once, so a few multi-GB videos
 *     don't split all the bandwidth or thrash the source.
 * Each op acquires the global slot FIRST, then (only if large) the large slot,
 * and releases in reverse. A large file therefore holds a global slot while
 * waiting for a large slot — but large files always make progress (some hold
 * the large slots and finish), so this never deadlocks.
 *
 * Pause is checked before starting each new op; in-flight ops are awaited to a
 * durable finish before returning. `yieldToEventLoop` after each op keeps the
 * HTTP server responsive during a long copy chunk.
 */
async function executePlan(db: Database, jobId: number, ops: PlannedOp[]): Promise<{ paused: boolean }> {
  const globalSem = new Semaphore(COPY_CONCURRENCY);
  const largeSem = new Semaphore(LARGE_FILE_CONCURRENCY);

  const running: Promise<void>[] = [];
  let paused = false;

  for (const op of ops) {
    // Per-op pause check for near-instant response: every op executed so far is
    // durable, so stopping before starting a new one is always safe.
    if (isPauseRequested(jobId)) {
      paused = true;
      break;
    }

    // Acquire the global slot in the driver loop so this loop only advances when
    // a slot is free — that both bounds concurrency and rate-limits how far ahead
    // we start ops (keeping the pause check meaningfully close to real progress).
    const releaseGlobal = await globalSem.acquire();
    const isLarge = op.sizeBytes >= LARGE_FILE_BYTES;

    const task = (async () => {
      let releaseLarge: (() => void) | null = null;
      try {
        if (isLarge) releaseLarge = await largeSem.acquire();
        await executeOp(db, jobId, op);
      } catch (err) {
        incrementImportJobCounters(db, jobId, { filesErrored: 1 });
        logImportJobEvent(db, jobId, op.sourcePath, "error", err instanceof Error ? err.message : String(err));
      } finally {
        if (releaseLarge) releaseLarge();
        releaseGlobal();
      }
      await yieldToEventLoop();
    })();
    running.push(task);
  }

  // Let every started op reach a durable finish before returning (whether we're
  // completing the chunk or pausing after it).
  await Promise.all(running);
  return { paused };
}

/**
 * Executes a single planned op. Preserves the critical move-THEN-insert ordering
 * for imports: the `media` row is only inserted after a verified move, so a
 * crash in between leaves a placed library file for a later reindex to pick up
 * (acceptable) rather than a DB row pointing at a file that isn't there.
 *
 * Throws on failure so the caller records a single `filesErrored` + 'error'
 * event; for an import it first calls `finishTransfer(..., null)` so the failed
 * transfer leaves the live active-transfers list.
 */
async function executeOp(db: Database, jobId: number, op: PlannedOp): Promise<void> {
  switch (op.action) {
    case "import": {
      const transferId = startTransfer(jobId, op.destFilename, op.sizeBytes);
      try {
        const destRelativePath = join(op.destRelativeDir, op.destFilename);
        const destAbsolutePath = join(getLibraryRoot(), destRelativePath);

        // Verified streaming move (never unlinks the source before the dest size
        // is confirmed), reporting bytes as they copy for the live progress bar.
        await safeMoveFileStreamed(op.sourcePath, destAbsolutePath, (n) => addBytes(jobId, transferId, n));

        // Move the companion .AAE sidecar alongside, renamed to the allocated
        // basename so it stays paired with its (possibly de-collided) media file.
        let companionRelativePath: string | null = null;
        if (op.companionAaePath) {
          try {
            const companionSourceName = basename(op.companionAaePath);
            const companionExt = companionSourceName.slice(companionSourceName.lastIndexOf("."));
            const companionDestName = baseNameNoExt(op.destFilename) + companionExt;
            const companionDestRelative = join(op.destRelativeDir, companionDestName);
            await safeMoveFile(op.companionAaePath, join(getLibraryRoot(), companionDestRelative));
            companionRelativePath = companionDestRelative;
          } catch {
            // Non-fatal: the main file is already safely placed; the sidecar just
            // stays behind unmoved rather than failing the whole import.
          }
        }

        const mediaId = insertMedia(db, {
          path: destAbsolutePath,
          relativePath: destRelativePath,
          filename: op.destFilename,
          extension: op.extension,
          mediaType: op.mediaType,
          captureDate: op.captureDate,
          captureDatetime: op.captureDatetime,
          dateSource: op.dateSource,
          sizeBytes: op.sizeBytes,
          contentHash: op.fingerprint,
          width: op.meta?.imageWidth ?? null,
          height: op.meta?.imageHeight ?? null,
          durationSeconds: op.meta?.duration ?? null,
          companionAaePath: companionRelativePath,
          sourcePath: op.sourcePath,
          importedAt: new Date().toISOString(),
          origin: op.origin,
        });

        finishTransfer(jobId, transferId, mediaId, op.destFilename);
        incrementImportJobCounters(db, jobId, { filesImported: 1 });
        logImportJobEvent(db, jobId, op.sourcePath, "imported", null);
      } catch (err) {
        // Clear the live transfer even on failure so it leaves the active list.
        finishTransfer(jobId, transferId, null, op.destFilename);
        throw err;
      }
      return;
    }

    case "quarantine_duplicate": {
      // Byte-identical to a file already in the library — remove it from the
      // source (quarantine, recoverable) rather than physically duplicating it.
      await quarantineSource(op.sourcePath, op.filename, op.companionAaePath, jobId);
      incrementImportJobCounters(db, jobId, { filesSkippedDuplicate: 1 });
      logImportJobEvent(db, jobId, op.sourcePath, "skipped_duplicate", `matches existing ${op.matchedName}`);
      return;
    }

    case "skip_intrabatch_duplicate": {
      // A second byte-identical NEW file within THIS same import — quarantine the
      // source (so it's removed from the source but recoverable); we do NOT
      // insert a second media row, as the first copy is what gets imported.
      await quarantineSource(op.sourcePath, op.filename, op.companionAaePath, jobId);
      incrementImportJobCounters(db, jobId, { filesSkippedDuplicate: 1 });
      logImportJobEvent(
        db,
        jobId,
        op.sourcePath,
        "skipped_duplicate",
        `duplicate of another file in this import (${op.matchedName})`,
      );
      return;
    }
  }
}

/** Moves a source file (and its .AAE companion, if any) into the import-duplicate
 * quarantine dir — same behavior as the old sequential path's quarantineAsDuplicate,
 * used for both library duplicates and same-import duplicates. Uses the verified
 * (non-streaming) safeMoveFile: no live progress is reported for quarantines. */
async function quarantineSource(
  sourcePath: string,
  filename: string,
  companionAaePath: string | null,
  jobId: number,
): Promise<void> {
  await safeMoveFile(sourcePath, join(config.quarantineImportDuplicatesDir, `job${jobId}_${filename}`));
  if (companionAaePath) {
    const companionName = basename(companionAaePath);
    try {
      await safeMoveFile(
        companionAaePath,
        join(config.quarantineImportDuplicatesDir, `job${jobId}_${companionName}`),
      );
    } catch {
      // Non-fatal: the main duplicate file is already safely quarantined.
    }
  }
}
