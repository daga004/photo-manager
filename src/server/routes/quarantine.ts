import { Database } from "bun:sqlite";
import { readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";

/**
 * Quarantine size reporting + purge. Quarantine holds soft-deleted files across
 * three dirs: duplicates removed in the Duplicates view, files skipped as
 * duplicates during import, and single files deleted from the viewer. Purging is
 * PERMANENT (unlike the soft-delete that put files here), so it's gated behind a
 * staged confirmation in the UI.
 */
const DIRS = [
  { name: "duplicates", path: config.quarantineDuplicatesDir },
  { name: "import-duplicates", path: config.quarantineImportDuplicatesDir },
  { name: "deleted", path: config.quarantineDeletedDir },
] as const;

async function dirSize(dir: string): Promise<{ files: number; bytes: number }> {
  if (!existsSync(dir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await dirSize(p);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      try {
        bytes += (await stat(p)).size;
        files++;
      } catch {
        // A file that vanished between readdir and stat — just skip it.
      }
    }
  }
  return { files, bytes };
}

export function makeQuarantineInfoHandler() {
  return async (): Promise<Response> => {
    const categories = [];
    let totalFiles = 0;
    let totalBytes = 0;
    for (const d of DIRS) {
      const s = await dirSize(d.path);
      categories.push({ name: d.name, files: s.files, bytes: s.bytes });
      totalFiles += s.files;
      totalBytes += s.bytes;
    }
    return Response.json({ categories, totalFiles, totalBytes });
  };
}

export function makeQuarantinePurgeHandler(db: Database) {
  return async (): Promise<Response> => {
    try {
      // 1) Hard-delete the quarantined index rows, keeping the DB consistent with
      //    the about-to-be-emptied dirs. Null out any device-import references
      //    first so foreign keys (enabled) don't block the delete.
      let removedRows = 0;
      db.transaction(() => {
        const quarantined = "(SELECT id FROM media WHERE status = 'quarantined')";
        // Clear both foreign keys that reference media(id) before the delete:
        //  - device_import_items.media_id is nullable → null it out;
        //  - duplicate_resolutions.kept_media_id is NOT NULL → delete the row
        //    (it's an audit record for media that's being purged anyway).
        db.query(`UPDATE device_import_items SET media_id = NULL WHERE media_id IN ${quarantined}`).run();
        db.query(`DELETE FROM duplicate_resolutions WHERE kept_media_id IN ${quarantined}`).run();
        removedRows = db.query("DELETE FROM media WHERE status = 'quarantined'").run().changes;
      })();

      // 2) Physically empty the quarantine dirs (all three), removing files that
      //    have no index row too (import-duplicates were never indexed).
      let deletedEntries = 0;
      for (const d of DIRS) {
        if (!existsSync(d.path)) continue;
        for (const name of await readdir(d.path)) {
          try {
            await rm(join(d.path, name), { recursive: true, force: true });
            deletedEntries++;
          } catch {
            // Best-effort: skip anything we can't remove and keep going.
          }
        }
      }

      return Response.json({ purged: true, removedRows, deletedEntries });
    } catch (err) {
      return Response.json(
        { error: `purge failed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 },
      );
    }
  };
}
