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
import { getLibraryRoot, getPhotosDir, getVideosDir } from "../config.ts";
import { HASH_CONCURRENCY } from "../../shared/constants.ts";
import { scanDirectory, type ScannedFile } from "./scanner.ts";
import { batchExtractMetadata, type ExifMetadata } from "./exif.ts";
import { sampledFingerprint } from "./hash.ts";
import { resolveCaptureDate } from "./dateFallback.ts";
import { runWithConcurrency, yieldToEventLoop } from "./concurrency.ts";
import { isPauseRequested } from "./jobControl.ts";

/** Files fingerprinted + inserted per chunk. Chunking bounds how much work a
 * pause discards (at most one chunk) and lets progress/inserts stream steadily
 * instead of all inserts happening after all fingerprinting. */
const REINDEX_CHUNK_SIZE = 200;

/**
 * Walks the existing library in place (photos/ and videos/ under the
 * library root) and indexes anything not already in the DB. Never moves
 * files — reindex only ever catches up an existing archive to the index.
 *
 * Resumable by construction: re-running against the same jobId re-scans
 * (cheap) and skips any path already present in `media`, so a restart or a
 * pause continues rather than redoing already-indexed files.
 *
 * Unlike folder import, reindex does NOT quarantine hash-duplicates — these
 * files are already in their rightful place with nothing to move away from;
 * genuine duplicates surface later via the Duplicates view's hash grouping.
 */
export async function runReindexJob(db: Database, jobId: number): Promise<void> {
  try {
    const scanned = [...(await scanDirectory(getPhotosDir())), ...(await scanDirectory(getVideosDir()))];
    updateImportJob(db, jobId, { filesFound: scanned.length });

    const pending = scanned.filter((f) => !findMediaByPath(db, f.absolutePath));
    const alreadyIndexedCount = scanned.length - pending.length;
    // SET (not increment) filesProcessed to the count already in the index, so
    // a resume reports the true running total rather than stacking the
    // already-indexed count on top of the previous run's counter.
    updateImportJob(db, jobId, { filesProcessed: alreadyIndexedCount });

    for (let start = 0; start < pending.length; start += REINDEX_CHUNK_SIZE) {
      // Pause checkpoint — only between chunks, where every prior chunk is
      // already fully persisted, so a pause never loses committed work.
      if (isPauseRequested(jobId)) {
        updateImportJob(db, jobId, { status: "paused" });
        return;
      }

      const chunk = pending.slice(start, start + REINDEX_CHUNK_SIZE);

      // Fingerprint (~128KB read) and stat each file concurrently. Capturing
      // size+mtime here means the insert step needs no second stat round-trip.
      const prepared = await runWithConcurrency(chunk, HASH_CONCURRENCY, async (f) => {
        const [hash, st] = await Promise.all([sampledFingerprint(f.absolutePath), stat(f.absolutePath)]);
        incrementImportJobCounters(db, jobId, { filesProcessed: 1 });
        return { file: f, hash, sizeBytes: st.size, mtimeMs: st.mtimeMs };
      });

      const metaMap = await batchExtractMetadata(chunk.map((f) => f.absolutePath));

      for (const p of prepared) {
        try {
          insertReindexRow(db, p.file, p.hash, p.sizeBytes, p.mtimeMs, metaMap.get(p.file.absolutePath));
          incrementImportJobCounters(db, jobId, { filesImported: 1 });
        } catch (err) {
          incrementImportJobCounters(db, jobId, { filesErrored: 1 });
          logImportJobEvent(db, jobId, p.file.absolutePath, "error", err instanceof Error ? err.message : String(err));
        }
      }
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

function insertReindexRow(
  db: Database,
  file: ScannedFile,
  hash: string,
  sizeBytes: number,
  mtimeMs: number,
  meta: ExifMetadata | undefined,
): void {
  const { captureDate, captureDatetime, dateSource } = resolveCaptureDate({
    dateTimeOriginal: meta?.dateTimeOriginal,
    createDate: meta?.createDate,
    fileMtimeMs: mtimeMs,
  });

  insertMedia(db, {
    path: file.absolutePath,
    relativePath: relative(getLibraryRoot(),file.absolutePath),
    filename: file.filename,
    extension: file.extension,
    mediaType: file.mediaType,
    captureDate,
    captureDatetime,
    dateSource,
    sizeBytes,
    contentHash: hash,
    width: meta?.imageWidth ?? null,
    height: meta?.imageHeight ?? null,
    durationSeconds: meta?.duration ?? null,
    companionAaePath: file.companionAaePath ? relative(getLibraryRoot(),file.companionAaePath) : null,
    sourcePath: null,
    importedAt: null,
  });
}
