import { Database } from "bun:sqlite";
import { basename, join } from "node:path";
import {
  getImportJob,
  incrementImportJobCounters,
  logImportJobEvent,
  updateImportJob,
} from "../db.ts";
import { config } from "../config.ts";
import { HASH_CONCURRENCY } from "../../shared/constants.ts";
import { scanDirectory, type ScannedFile } from "./scanner.ts";
import { batchExtractMetadata, type ExifMetadata } from "./exif.ts";
import { sampledFingerprint } from "./hash.ts";
import { safeMoveFile } from "./fsmove.ts";
import { runWithConcurrency, yieldToEventLoop } from "./concurrency.ts";
import { placeAndIndexFile } from "./placeAndIndex.ts";
import { isPauseRequested } from "./jobControl.ts";

/** Files fingerprinted + placed per chunk. Chunking makes progress track the
 * SLOW placement step (not the fast fingerprint), bounds pause-discarded work,
 * and lets the user pause mid-import. */
const IMPORT_CHUNK_SIZE = 100;

/**
 * Imports every media file found (recursively) under `sourcePath` into the
 * library, organized as photos|videos/YYYY/MM/DD/. Files whose content
 * already exists elsewhere in the library are quarantined (not physically
 * duplicated) rather than copied in.
 *
 * Processes in chunks: each chunk is fingerprinted concurrently, then its
 * files are placed strictly sequentially (two files landing in the same
 * destination directory must never race on the same filename allocation).
 * filesProcessed is bumped only when a file is fully placed/quarantined, so
 * the progress bar reflects real end-to-end progress — the moving of files
 * over the network share is the slow part, not the fast sampled fingerprint.
 */
export async function runImportJob(db: Database, jobId: number, sourcePath: string): Promise<void> {
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

      // Phase 2 (slow): actually move each file into the library. The terminal
      // counters (imported/skipped/errored) track this copy step — that's what
      // the progress bar reflects, so the bar isn't "done" while copying runs.
      for (let i = 0; i < chunk.length; i++) {
        // Per-file pause check for near-instant response: each placed file is
        // already durably moved + indexed, so bailing mid-chunk is safe. The
        // rest of this chunk is simply re-scanned (and cheaply re-fingerprinted)
        // on resume.
        if (isPauseRequested(jobId)) {
          updateImportJob(db, jobId, { status: "paused" });
          return;
        }

        const file = chunk[i] as ScannedFile;
        const hash = hashes[i] as string;
        try {
          await importOneFile(db, jobId, file, hash, metaMap.get(file.absolutePath));
        } catch (err) {
          incrementImportJobCounters(db, jobId, { filesErrored: 1 });
          logImportJobEvent(db, jobId, file.absolutePath, "error", err instanceof Error ? err.message : String(err));
        }
        await yieldToEventLoop();
      }
    }

    updateImportJob(db, jobId, { status: "completed", finishedAt: new Date().toISOString() });
  } catch (err) {
    updateImportJob(db, jobId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      lastError: err instanceof Error ? err.message : String(err),
    });
  }
}

async function importOneFile(
  db: Database,
  jobId: number,
  file: ScannedFile,
  hash: string,
  meta: ExifMetadata | undefined,
): Promise<void> {
  const result = await placeAndIndexFile(db, {
    localSourcePath: file.absolutePath,
    filename: file.filename,
    mediaType: file.mediaType,
    extension: file.extension,
    hash,
    meta,
    sourcePathForAudit: file.absolutePath,
    importedAt: new Date().toISOString(),
    companionAaePath: file.companionAaePath,
  });

  if (result.kind === "duplicate") {
    await quarantineAsDuplicate(file, jobId);
    incrementImportJobCounters(db, jobId, { filesSkippedDuplicate: 1 });
    logImportJobEvent(db, jobId, file.absolutePath, "skipped_duplicate", null);
    return;
  }

  incrementImportJobCounters(db, jobId, { filesImported: 1 });
  logImportJobEvent(db, jobId, file.absolutePath, "imported", null);
}

async function quarantineAsDuplicate(file: ScannedFile, jobId: number): Promise<void> {
  const dest = join(config.quarantineImportDuplicatesDir, `job${jobId}_${file.filename}`);
  await safeMoveFile(file.absolutePath, dest);
  if (file.companionAaePath) {
    const companionName = basename(file.companionAaePath);
    try {
      await safeMoveFile(
        file.companionAaePath,
        join(config.quarantineImportDuplicatesDir, `job${jobId}_${companionName}`),
      );
    } catch {
      // Non-fatal: the main duplicate file is already safely quarantined.
    }
  }
}
