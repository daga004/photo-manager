import { Database } from "bun:sqlite";
import { mkdir, rm, unlink, utimes } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  createDeviceImportItems,
  getDeviceImportItems,
  incrementImportJobCounters,
  logImportJobEvent,
  setDeviceImportItemPhase,
  updateImportJob,
} from "../db.ts";
import { config } from "../config.ts";
import { HASH_CONCURRENCY } from "../../shared/constants.ts";
import { classifyExtension, getExtension, type MediaType } from "../../shared/extensions.ts";
import type { DeviceImportItemRecord } from "../../shared/types.ts";
import { listDevicePhotos, copyFilesFromDevice, deleteFilesFromDevice } from "./afc.ts";
import { sampledFingerprint } from "./hash.ts";
import { batchExtractMetadata } from "./exif.ts";
import { runWithConcurrency, yieldToEventLoop } from "./concurrency.ts";
import { placeAndIndexFile } from "./placeAndIndex.ts";

/** Files per afcclient session for copy/delete — the interruption checkpoint
 * granularity (see afc.ts's copyFilesFromDevice/deleteFilesFromDevice docs). */
const DEVICE_BATCH_SIZE = 25;

/**
 * Imports photos/videos from a connected iPhone through three independently
 * resumable phases tracked per-file in `device_import_items`:
 *
 *   pending -> copied -> indexed -> ready_to_delete -> deleted
 *
 * Copy and delete never interleave file-by-file: nothing becomes eligible
 * for phase 3 (delete) until it's already durably indexed in the library.
 * Re-running this against the same jobId (a "resume") re-queries items by
 * phase and continues exactly where it left off — listing the device again
 * is cheap and uses INSERT OR IGNORE so it never duplicates tracked items.
 */
export async function runDeviceImportJob(
  db: Database,
  jobId: number,
  udid: string,
  deleteAfterVerify: boolean,
): Promise<void> {
  try {
    const existingItems = getDeviceImportItems(db, jobId);
    if (existingItems.length === 0) {
      const devicePhotos = await listDevicePhotos(udid);
      createDeviceImportItems(db, jobId, devicePhotos);
      updateImportJob(db, jobId, { filesFound: devicePhotos.length });
    }

    await runCopyPhase(db, jobId, udid);
    await runIndexPhase(db, jobId);
    if (deleteAfterVerify) {
      await runDeletePhase(db, jobId, udid);
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

async function runCopyPhase(db: Database, jobId: number, udid: string): Promise<void> {
  const pending = getDeviceImportItems(db, jobId, ["pending"]);
  if (pending.length === 0) return;

  const tempDir = join(config.dataDir, "tmp", `device-import-${jobId}`);
  await mkdir(tempDir, { recursive: true });

  for (let i = 0; i < pending.length; i += DEVICE_BATCH_SIZE) {
    const batch = pending.slice(i, i + DEVICE_BATCH_SIZE);
    const withLocalPaths = batch.map((item) => ({
      item,
      localTempPath: join(tempDir, `${item.id}_${item.filename}`),
    }));

    await copyFilesFromDevice(
      udid,
      withLocalPaths.map((f) => ({ devicePath: f.item.devicePath, localDestPath: f.localTempPath })),
    );

    for (const { item, localTempPath } of withLocalPaths) {
      try {
        const st = await stat(localTempPath);
        if (st.size === item.expectedSizeBytes) {
          // afcclient's `get` doesn't preserve the device's original mtime on
          // the local copy it writes (confirmed empirically) — without this,
          // any photo lacking embedded EXIF dates would fall back to "today"
          // instead of its real capture date. See afc.ts's parseAfcLsDate.
          if (item.deviceMtimeMs !== null) {
            const mtime = new Date(item.deviceMtimeMs);
            await utimes(localTempPath, mtime, mtime).catch(() => {});
          }
          setDeviceImportItemPhase(db, item.id, "copied", { localTempPath });
        } else {
          setDeviceImportItemPhase(db, item.id, "copy_failed", {
            lastError: `size mismatch after copy: expected ${item.expectedSizeBytes}, got ${st.size}`,
          });
          incrementImportJobCounters(db, jobId, { filesErrored: 1 });
        }
      } catch (err) {
        setDeviceImportItemPhase(db, item.id, "copy_failed", {
          lastError: err instanceof Error ? err.message : String(err),
        });
        incrementImportJobCounters(db, jobId, { filesErrored: 1 });
      }
      incrementImportJobCounters(db, jobId, { filesProcessed: 1 });
      await yieldToEventLoop();
    }
  }
}

async function runIndexPhase(db: Database, jobId: number): Promise<void> {
  const copied = getDeviceImportItems(db, jobId, ["copied"]);
  if (copied.length === 0) return;

  const localPaths = copied.map((item) => item.localTempPath).filter((p): p is string => p !== null);
  const metaMap = await batchExtractMetadata(localPaths);
  const hashes = await runWithConcurrency(copied, HASH_CONCURRENCY, (item) =>
    item.localTempPath ? sampledFingerprint(item.localTempPath) : Promise.resolve(""),
  );

  for (let i = 0; i < copied.length; i++) {
    const item = copied[i] as DeviceImportItemRecord;
    const hash = hashes[i] as string;
    if (!item.localTempPath || !hash) {
      setDeviceImportItemPhase(db, item.id, "copy_failed", { lastError: "missing local temp file at index time" });
      continue;
    }
    try {
      const mediaType = classifyExtension(item.filename) as MediaType;
      const result = await placeAndIndexFile(db, {
        localSourcePath: item.localTempPath,
        filename: item.filename,
        mediaType,
        extension: getExtension(item.filename),
        hash,
        meta: metaMap.get(item.localTempPath),
        sourcePathForAudit: item.devicePath,
        importedAt: new Date().toISOString(),
      });

      if (result.kind === "duplicate") {
        // Already have this content in the library — discard the scratch
        // temp copy. It's still safe to delete from the device afterward:
        // the library already durably has this content under a different path.
        await unlink(item.localTempPath).catch(() => {});
        setDeviceImportItemPhase(db, item.id, "ready_to_delete");
        logImportJobEvent(db, jobId, item.devicePath, "skipped_duplicate", `matches existing ${result.matchedName}`);
        incrementImportJobCounters(db, jobId, { filesSkippedDuplicate: 1 });
      } else {
        setDeviceImportItemPhase(db, item.id, "ready_to_delete", { mediaId: result.mediaId });
        logImportJobEvent(db, jobId, item.devicePath, "imported", null);
        incrementImportJobCounters(db, jobId, { filesImported: 1 });
      }
    } catch (err) {
      setDeviceImportItemPhase(db, item.id, "copy_failed", {
        lastError: `indexing failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      incrementImportJobCounters(db, jobId, { filesErrored: 1 });
    }
    await yieldToEventLoop();
  }
}

async function runDeletePhase(db: Database, jobId: number, udid: string): Promise<void> {
  const readyToDelete = getDeviceImportItems(db, jobId, ["ready_to_delete"]);
  if (readyToDelete.length === 0) return;

  for (let i = 0; i < readyToDelete.length; i += DEVICE_BATCH_SIZE) {
    const batch = readyToDelete.slice(i, i + DEVICE_BATCH_SIZE);
    try {
      await deleteFilesFromDevice(
        udid,
        batch.map((item) => item.devicePath),
      );
      for (const item of batch) {
        setDeviceImportItemPhase(db, item.id, "deleted");
        incrementImportJobCounters(db, jobId, { filesDeletedFromDevice: 1 });
      }
    } catch (err) {
      // The whole batch's session failed to run at all (e.g. device
      // disconnected) — leave every item in this batch at ready_to_delete
      // so a resume retries them; nothing here is marked deleted incorrectly.
      for (const item of batch) {
        setDeviceImportItemPhase(db, item.id, "delete_failed", {
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await yieldToEventLoop();
  }
}

/**
 * Cleans up the temp copy directory for a device-import job. Safe to call
 * even if items are still pending — only removes what's there.
 */
export async function cleanupDeviceImportTempDir(jobId: number): Promise<void> {
  const tempDir = join(config.dataDir, "tmp", `device-import-${jobId}`);
  await rm(tempDir, { recursive: true, force: true });
}
