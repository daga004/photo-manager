import { rename, mkdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { getDb, markUndated } from "../src/server/db.ts";
import { getLibraryRoot } from "../src/server/config.ts";

// Relocates the files that could not be dated by any means (EXIF or filename)
// and were placed under the fabricated import-day 2026/07/19 by the mtime
// fallback, into <photos|videos>/undated/. Files genuinely captured today keep
// a real EXIF date (date_source != file_mtime) and are left untouched.
const db = getDb();
const root = getLibraryRoot();

interface Row {
  id: number;
  path: string;
  media_type: string;
  filename: string;
}

const rows = db
  .query(
    "SELECT id, path, media_type, filename FROM media WHERE status = 'active' AND is_undated = 0 AND capture_date = '2026-07-19' AND date_source = 'file_mtime'",
  )
  .all() as Row[];

console.log(`Qualifying rows: ${rows.length}`);

let moved = 0;
let missing = 0;
let errored = 0;
const takenNames = new Set<string>();

for (const row of rows) {
  const bucket = row.media_type === "photo" ? "photos" : "videos";
  const destDir = join(root, bucket, "undated");
  try {
    if (!existsSync(row.path)) {
      missing++;
      continue;
    }
    await mkdir(destDir, { recursive: true });

    // Allocate a free name in the undated dir (avoid clobbering).
    let name = row.filename;
    let dest = join(destDir, name);
    let n = 2;
    while (takenNames.has(dest) || existsSync(dest)) {
      const dot = row.filename.lastIndexOf(".");
      const base = dot === -1 ? row.filename : row.filename.slice(0, dot);
      const ext = dot === -1 ? "" : row.filename.slice(dot);
      name = `${base}__dup${n}${ext}`;
      dest = join(destDir, name);
      n++;
    }
    takenNames.add(dest);

    await rename(row.path, dest); // same volume -> instant
    const relativePath = `${bucket}/undated/${basename(dest)}`;
    markUndated(db, row.id, dest, relativePath);
    moved++;
    if (moved % 200 === 0) console.log(`  moved ${moved}...`);
  } catch (err) {
    errored++;
    console.error(`  error on ${row.path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`Done. moved=${moved} missing=${missing} errored=${errored}`);
