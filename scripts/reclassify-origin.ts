import { getDb } from "../src/server/db.ts";
import { batchExtractMetadata, originFromMeta } from "../src/server/services/exif.ts";

// Backfills origin for existing rows by re-reading EXIF Make: any active
// 'camera'-classified file that actually has no camera Make (WhatsApp,
// download, screenshot) is reclassified 'other', cleaning it out of the date
// timeline and into the Non-camera bucket. Undated files are already 'other'.
const db = getDb();
const rows = db
  .query("SELECT id, path FROM media WHERE status = 'active' AND origin = 'camera'")
  .all() as Array<{ id: number; path: string }>;
console.log(`Candidates to check: ${rows.length}`);

const update = db.query("UPDATE media SET origin = 'other' WHERE id = ?");
const CHUNK = 400;
let checked = 0;
let reclassified = 0;

for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const metaMap = await batchExtractMetadata(chunk.map((r) => r.path));
  db.transaction(() => {
    for (const r of chunk) {
      if (originFromMeta(metaMap.get(r.path)) === "other") {
        update.run(r.id);
        reclassified++;
      }
    }
  })();
  checked += chunk.length;
  if (checked % 2000 < CHUNK) console.log(`  checked ${checked}/${rows.length}, reclassified ${reclassified}...`);
}

console.log(`Done. checked=${checked} reclassified=${reclassified}`);
