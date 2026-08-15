import { Database } from "bun:sqlite";
import { findActiveJob, getPendingThumbnails, setThumbnailStatus } from "../db.ts";
import { ensureRenderedImage } from "./thumbnails.ts";
import { runWithConcurrency, yieldToEventLoop } from "./concurrency.ts";

/**
 * Background thumbnail pre-generator.
 *
 * Thumbnails are otherwise generated lazily on first view — which, on a spinning
 * external drive, means the first scroll through a day pays for reading each big
 * HEIC/RAW/JPEG original off disk and decoding it, right on the interactive path.
 * This worker warms the cache ahead of time so browsing feels instant.
 *
 * It's deliberately a LOW-priority citizen:
 *   - It PAUSES entirely while an import/reindex job is running, so it never
 *     competes with that job for the (mechanical, bandwidth-limited) drive.
 *   - It works at low concurrency and yields to the event loop between items, so
 *     interactive thumbnail/preview requests and HTTP handling stay responsive.
 *   - It drains `thumbnail_status = 'pending'` to empty, then idles and re-checks
 *     periodically, so newly imported files get picked up without a restart.
 *
 * Cache generation itself is idempotent (keyed by content hash, existence-checked
 * in ensureRenderedImage), so a file whose thumbnail already exists — e.g. one
 * generated lazily by a prior view — costs only a stat and is simply marked done.
 */
const BATCH = 50;
const PREGEN_CONCURRENCY = 2; // gentle: leave headroom for interactive requests
const PAUSED_FOR_IMPORT_MS = 5000; // re-check for import completion this often
const CAUGHT_UP_MS = 30_000; // nothing pending: wait this long before re-scanning

let started = false;

export function startThumbnailPregen(db: Database): void {
  if (started) return; // one loop per process
  started = true;
  void loop(db);
}

async function loop(db: Database): Promise<void> {
  // Small initial delay so it never contends with server startup work.
  await sleep(2000);
  for (;;) {
    try {
      // Stay out of the way of any active import/reindex — the drive is the
      // bottleneck and that job should have it to itself.
      if (findActiveJob(db)) {
        await sleep(PAUSED_FOR_IMPORT_MS);
        continue;
      }

      const batch = getPendingThumbnails(db, BATCH);
      if (batch.length === 0) {
        await sleep(CAUGHT_UP_MS);
        continue;
      }

      let done = 0;
      let errored = 0;
      await runWithConcurrency(batch, PREGEN_CONCURRENCY, async (m) => {
        try {
          const result = await ensureRenderedImage({
            contentHash: m.contentHash,
            sourcePath: m.path,
            mediaType: m.mediaType,
            variant: "thumb",
          });
          setThumbnailStatus(db, m.id, result.status, result.path);
          if (result.status === "done") done++;
          else errored++;
        } catch (err) {
          // A single unreadable/missing file must not kill the worker; mark it
          // errored so the batch drains and we don't loop on it forever.
          setThumbnailStatus(db, m.id, "error", null);
          errored++;
          console.error(`thumbnail pregen failed for #${m.id} (${m.path}):`, err instanceof Error ? err.message : err);
        }
      });
      // runWithConcurrency already yields between items, but yield once more so a
      // burst of interactive requests gets scheduled promptly between batches.
      await yieldToEventLoop();
      if (done || errored) console.log(`thumbnail pregen: +${done} generated, ${errored} errored (batch of ${batch.length})`);
    } catch (err) {
      // Never let the loop die — back off briefly and carry on.
      console.error("thumbnail pregen loop error:", err instanceof Error ? err.message : err);
      await sleep(CAUGHT_UP_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
