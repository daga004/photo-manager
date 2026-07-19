import { Database } from "bun:sqlite";
import { relative } from "node:path";
import { stat } from "node:fs/promises";
import {
  findMediaByPath,
  incrementImportJobCounters,
  insertMedia,
  logImportJobEvent,
  updateImportJob,
} from "../db.ts";
import { config } from "../config.ts";
import { HASH_CONCURRENCY } from "../../shared/constants.ts";
import { scanDirectory, type ScannedFile } from "./scanner.ts";
import { batchExtractMetadata, type ExifMetadata } from "./exif.ts";
import { sampledFingerprint } from "./hash.ts";
import { resolveCaptureDate } from "./dateFallback.ts";
import { runWithConcurrency, yieldToEventLoop } from "./concurrency.ts";

/**
 * Walks the existing library in place (photos/ and videos/ under the
 * library root) and indexes anything not already in the DB. Never moves
 * files — reindex only ever catches up an existing archive to the index.
 *
 * Resumable by construction: re-running against the same jobId re-scans
 * (cheap) and skips any path already present in `media`, so a restart after
 * a crash continues rather than redoing already-indexed files. Skipped
 * files still count toward filesProcessed so the counter keeps climbing
 * across a resume instead of appearing to reset.
 *
 * Unlike folder import, reindex does NOT quarantine hash-duplicates — these
 * files are already in their rightful place with nothing to move away from;
 * genuine duplicates surface later via the Duplicates view's hash grouping.
 */
export async function runReindexJob(db: Database, jobId: number): Promise<void> {
  try {
    const scanned = [...(await scanDirectory(config.photosDir)), ...(await scanDirectory(config.videosDir))];
    updateImportJob(db, jobId, { filesFound: scanned.length });

    if (scanned.length === 0) {
      updateImportJob(db, jobId, { status: "completed", finishedAt: new Date().toISOString() });
      return;
    }

    const pending = scanned.filter((f) => !findMediaByPath(db, f.absolutePath));
    const alreadyIndexedCount = scanned.length - pending.length;
    // SET (not increment) filesProcessed to the count already in the index, so
    // a resume reports the true running total (already-indexed + newly-done)
    // rather than adding the already-indexed count on top of the previous
    // run's counter — which would push filesProcessed past filesFound.
    updateImportJob(db, jobId, { filesProcessed: alreadyIndexedCount });

    if (pending.length > 0) {
      // Sampled fingerprint (~128KB/file) instead of a full-content read —
      // this is the whole point of the speedup. filesProcessed is bumped per
      // file as each fingerprint completes so the progress bar tracks it live.
      const hashes = await runWithConcurrency(pending, HASH_CONCURRENCY, async (f) => {
        const hash = await sampledFingerprint(f.absolutePath);
        incrementImportJobCounters(db, jobId, { filesProcessed: 1 });
        return hash;
      });
      const metaMap = await batchExtractMetadata(pending.map((f) => f.absolutePath));

      for (let i = 0; i < pending.length; i++) {
        const file = pending[i] as ScannedFile;
        const hash = hashes[i] as string;
        try {
          await reindexOneFile(db, file, hash, metaMap.get(file.absolutePath));
          incrementImportJobCounters(db, jobId, { filesImported: 1 });
          logImportJobEvent(db, jobId, file.absolutePath, "imported", null);
        } catch (err) {
          incrementImportJobCounters(db, jobId, { filesErrored: 1 });
          logImportJobEvent(db, jobId, file.absolutePath, "error", err instanceof Error ? err.message : String(err));
        }
        // See concurrency.ts's yieldToEventLoop doc comment: without this, a
        // long sequential per-file loop starves concurrent HTTP handling.
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

async function reindexOneFile(
  db: Database,
  file: ScannedFile,
  hash: string,
  meta: ExifMetadata | undefined,
): Promise<void> {
  const srcStat = await stat(file.absolutePath);
  const { captureDate, captureDatetime, dateSource } = resolveCaptureDate({
    dateTimeOriginal: meta?.dateTimeOriginal,
    createDate: meta?.createDate,
    fileMtimeMs: srcStat.mtimeMs,
  });

  insertMedia(db, {
    path: file.absolutePath,
    relativePath: relative(config.libraryRoot, file.absolutePath),
    filename: file.filename,
    extension: file.extension,
    mediaType: file.mediaType,
    captureDate,
    captureDatetime,
    dateSource,
    sizeBytes: srcStat.size,
    contentHash: hash,
    width: meta?.imageWidth ?? null,
    height: meta?.imageHeight ?? null,
    durationSeconds: meta?.duration ?? null,
    companionAaePath: file.companionAaePath ? relative(config.libraryRoot, file.companionAaePath) : null,
    sourcePath: null,
    importedAt: null,
  });
}
