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

/**
 * Imports every media file found (recursively) under `sourcePath` into the
 * library, organized as photos|videos/YYYY/MM/DD/. Files whose content
 * already exists elsewhere in the library are quarantined (not physically
 * duplicated) rather than copied in.
 *
 * Hashing runs with bounded concurrency (pure I/O + compute, no DB writes).
 * The decide-destination -> move -> insert step (placeAndIndexFile) then
 * runs strictly sequentially per file: two files landing in the same
 * destination directory within one job must never race on the same
 * collision decision.
 */
export async function runImportJob(db: Database, jobId: number, sourcePath: string): Promise<void> {
  try {
    const scanned = await scanDirectory(sourcePath);
    // filesFound is only set on the FIRST run: a resume re-scans the source
    // folder, which naturally shrinks as already-imported files are moved
    // out of it — overwriting filesFound on every resume would make it drift
    // downward while filesProcessed keeps accumulating across resumes,
    // eventually showing >100% progress. Confirmed this exact drift this
    // session on a real resumed import.
    const existingJob = getImportJob(db, jobId);
    if (!existingJob || existingJob.filesFound === 0) {
      updateImportJob(db, jobId, { filesFound: scanned.length });
    }

    if (scanned.length === 0) {
      updateImportJob(db, jobId, { status: "completed", finishedAt: new Date().toISOString() });
      return;
    }

    // filesProcessed is bumped here, per file, as hashing (the long pole for
    // a large import) actually completes — not just at the end of the whole
    // batch, so the progress bar doesn't sit at 0% for the entire hash phase.
    const hashes = await runWithConcurrency(scanned, HASH_CONCURRENCY, async (f) => {
      const hash = await sampledFingerprint(f.absolutePath);
      incrementImportJobCounters(db, jobId, { filesProcessed: 1 });
      return hash;
    });
    const metaMap = await batchExtractMetadata(scanned.map((f) => f.absolutePath));

    for (let i = 0; i < scanned.length; i++) {
      const file = scanned[i] as ScannedFile;
      const hash = hashes[i] as string;
      try {
        await importOneFile(db, jobId, file, hash, metaMap.get(file.absolutePath));
      } catch (err) {
        incrementImportJobCounters(db, jobId, { filesErrored: 1 });
        logImportJobEvent(db, jobId, file.absolutePath, "error", err instanceof Error ? err.message : String(err));
      }
      // See yieldToEventLoop's doc comment: without this, a long sequential
      // per-file loop can starve concurrent HTTP request handling entirely.
      await yieldToEventLoop();
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
