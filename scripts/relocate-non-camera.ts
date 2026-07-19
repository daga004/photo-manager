import { rename, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { getDb } from "../src/server/db.ts";
import { getLibraryRoot } from "../src/server/config.ts";

// Physically relocates dated non-camera files (origin='other', not undated)
// into <photos|videos>/non-camera/, updating each DB row with the move so the
// index stays consistent (no reindex needed). Undated files already live under
// <...>/undated/ and are left there.
const db = getDb();
const root = getLibraryRoot();
const rows = db
  .query(
    "SELECT id, path, media_type, filename FROM media WHERE status = 'active' AND origin = 'other' AND is_undated = 0",
  )
  .all() as Array<{ id: number; path: string; media_type: string; filename: string }>;
console.log(`Non-camera files to move: ${rows.length}`);

const update = db.query("UPDATE media SET path = ?, relative_path = ? WHERE id = ?");
const taken = new Set<string>();
let moved = 0,
  missing = 0,
  errored = 0;

for (const row of rows) {
  const bucket = row.media_type === "photo" ? "photos" : "videos";
  const destDir = join(root, bucket, "non-camera");
  try {
    if (!existsSync(row.path)) {
      missing++;
      continue;
    }
    await mkdir(destDir, { recursive: true });
    let name = row.filename;
    let dest = join(destDir, name);
    let n = 2;
    while (taken.has(dest) || existsSync(dest)) {
      const dot = row.filename.lastIndexOf(".");
      const base = dot === -1 ? row.filename : row.filename.slice(0, dot);
      const ext = dot === -1 ? "" : row.filename.slice(dot);
      name = `${base}__dup${n}${ext}`;
      dest = join(destDir, name);
      n++;
    }
    taken.add(dest);
    await rename(row.path, dest);
    update.run(dest, `${bucket}/non-camera/${basename(dest)}`, row.id);
    moved++;
    if (moved % 500 === 0) console.log(`  moved ${moved}...`);
  } catch (err) {
    errored++;
    console.error(`  error on ${row.path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`Done. moved=${moved} missing=${missing} errored=${errored}`);
