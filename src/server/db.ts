import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { HASH_ALGO } from "../shared/constants.ts";
import type { DeviceImportItemRecord, ImportJobEventRecord, ImportJobRecord, MediaRecord } from "../shared/types.ts";

let db: Database | null = null;

/**
 * Opens (or returns the already-open) database connection and applies
 * migrations. Deliberately does NOT run reconcileStuckJobs — that must only
 * ever run once, at actual long-lived server startup (see index.ts). Confirmed
 * empirically: a one-off script (e.g. an ad-hoc `bun -e` diagnostic query)
 * also calls getDb(), and if reconciliation ran here, it would incorrectly
 * flip a job that's genuinely still executing in the live server process to
 * 'stalled' — the two processes share the same SQLite file, so this script's
 * "no process could still legitimately be running this" assumption doesn't
 * hold when the real server actually is.
 */
export function getDb(): Database {
  if (db) return db;
  mkdirSync(config.dataDir, { recursive: true });
  db = new Database(config.dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  // Foreign keys are enabled AFTER migrations, not before: SQLite's supported
  // way to change a table that other tables reference (e.g. altering a CHECK
  // constraint) is create-new/copy/drop-old/rename with FK enforcement off, so
  // the drop doesn't fight child foreign keys. Normal operation runs with FKs on.
  runMigrations(db);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

function runMigrations(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationsDir = join(import.meta.dir, "migrations");
  const applied = new Set(
    database.query("SELECT id FROM schema_migrations").all().map((row) => (row as { id: string }).id),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    database.transaction(() => {
      database.exec(sql);
      database
        .query("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run(file, new Date().toISOString());
    })();
    console.log(`[migrate] applied ${file}`);
  }
}

/**
 * A job left `running` only happens if the process died mid-job (crash, kill,
 * restart). It cannot actually still be running in a fresh process, so mark
 * it `stalled` — the UI then offers Resume instead of showing a hung job.
 */
export function reconcileStuckJobs(database: Database): void {
  const result = database
    .query("UPDATE import_jobs SET status = 'stalled' WHERE status = 'running'")
    .run();
  if (result.changes > 0) {
    console.log(`[db] reconciled ${result.changes} stuck 'running' job(s) to 'stalled' on startup`);
  }
}

// --- media table queries -----------------------------------------------

interface MediaRow {
  id: number;
  path: string;
  relative_path: string;
  filename: string;
  extension: string;
  media_type: string;
  capture_date: string;
  capture_datetime: string | null;
  date_source: string;
  size_bytes: number;
  content_hash: string;
  content_hash_algo: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  companion_aae_path: string | null;
  source_path: string | null;
  imported_at: string | null;
  indexed_at: string;
  status: string;
  quarantined_at: string | null;
  quarantine_path: string | null;
  quarantine_reason: string | null;
  thumbnail_status: string;
  thumbnail_path: string | null;
  is_undated: number;
  origin: string;
}

function rowToMediaRecord(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    path: row.path,
    relativePath: row.relative_path,
    filename: row.filename,
    extension: row.extension,
    mediaType: row.media_type as MediaRecord["mediaType"],
    captureDate: row.capture_date,
    captureDatetime: row.capture_datetime,
    dateSource: row.date_source as MediaRecord["dateSource"],
    sizeBytes: row.size_bytes,
    contentHash: row.content_hash,
    contentHashAlgo: row.content_hash_algo,
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
    companionAaePath: row.companion_aae_path,
    sourcePath: row.source_path,
    importedAt: row.imported_at,
    indexedAt: row.indexed_at,
    status: row.status as MediaRecord["status"],
    quarantinedAt: row.quarantined_at,
    quarantinePath: row.quarantine_path,
    quarantineReason: row.quarantine_reason,
    thumbnailStatus: row.thumbnail_status as MediaRecord["thumbnailStatus"],
    thumbnailPath: row.thumbnail_path,
    isUndated: row.is_undated === 1,
    origin: row.origin as MediaRecord["origin"],
  };
}

export function getMediaById(database: Database, id: number): MediaRecord | null {
  const row = database.query("SELECT * FROM media WHERE id = ?").get(id) as MediaRow | null;
  return row ? rowToMediaRecord(row) : null;
}

const SORT_COLUMNS = { count: "itemCount", size: "totalSizeBytes" } as const;

export function getDayAggregates(
  database: Database,
  options: { sortBy: "count" | "size"; order: "asc" | "desc"; type: "photo" | "video" | "all" },
): Array<{ date: string; itemCount: number; photoCount: number; videoCount: number; totalSizeBytes: number }> {
  const column = SORT_COLUMNS[options.sortBy];
  const direction = options.order === "asc" ? "ASC" : "DESC";
  const typeFilter = options.type === "all" ? "" : "AND media_type = $type";

  const rows = database
    .query(
      `SELECT
         capture_date AS date,
         COUNT(*) AS itemCount,
         SUM(CASE WHEN media_type = 'photo' THEN 1 ELSE 0 END) AS photoCount,
         SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) AS videoCount,
         SUM(size_bytes) AS totalSizeBytes
       FROM media
       WHERE status = 'active' AND is_undated = 0 AND origin = 'camera' ${typeFilter}
       GROUP BY capture_date
       ORDER BY ${column} ${direction}`,
    )
    .all(options.type === "all" ? {} : { $type: options.type }) as Array<{
    date: string;
    itemCount: number;
    photoCount: number;
    videoCount: number;
    totalSizeBytes: number;
  }>;
  return rows;
}

export function getDayItems(database: Database, date: string): MediaRecord[] {
  const rows = database
    .query("SELECT * FROM media WHERE status = 'active' AND is_undated = 0 AND origin = 'camera' AND capture_date = ? ORDER BY filename ASC")
    .all(date) as MediaRow[];
  return rows.map(rowToMediaRecord);
}

export function countNonCamera(database: Database): number {
  const row = database.query("SELECT COUNT(*) c FROM media WHERE status = 'active' AND origin = 'other' AND is_undated = 0").get() as { c: number };
  return row.c;
}

export function getNonCameraItems(database: Database): MediaRecord[] {
  const rows = database
    .query("SELECT * FROM media WHERE status = 'active' AND origin = 'other' AND is_undated = 0 ORDER BY filename ASC")
    .all() as MediaRow[];
  return rows.map(rowToMediaRecord);
}

export function countUndated(database: Database): number {
  const row = database.query("SELECT COUNT(*) c FROM media WHERE status = 'active' AND is_undated = 1").get() as { c: number };
  return row.c;
}

export function getUndatedItems(database: Database): MediaRecord[] {
  const rows = database
    .query("SELECT * FROM media WHERE status = 'active' AND is_undated = 1 ORDER BY filename ASC")
    .all() as MediaRow[];
  return rows.map(rowToMediaRecord);
}

/** Marks a media row undated and points it at its new relocated path, in one
 * update — the file move + this update keep the index consistent, so no
 * reindex is needed. */
export function markUndated(database: Database, mediaId: number, newPath: string, newRelativePath: string): void {
  database
    .query("UPDATE media SET is_undated = 1, path = ?, relative_path = ? WHERE id = ?")
    .run(newPath, newRelativePath, mediaId);
}

export interface DuplicateGroupRow {
  contentHash: string;
  sizeBytes: number;
  count: number;
}

export function findDuplicateHashGroups(database: Database, includeResolved: boolean): DuplicateGroupRow[] {
  const ignoredFilter = includeResolved
    ? ""
    : `AND content_hash NOT IN (SELECT content_hash FROM duplicate_resolutions WHERE action = 'ignored')`;
  const rows = database
    .query(
      `SELECT content_hash AS contentHash, size_bytes AS sizeBytes, COUNT(*) AS count
       FROM media
       WHERE status = 'active' ${ignoredFilter}
       GROUP BY content_hash
       HAVING COUNT(*) > 1
       ORDER BY size_bytes * COUNT(*) DESC`,
    )
    .all() as DuplicateGroupRow[];
  return rows;
}

export function findActiveMediaByHashAll(database: Database, contentHash: string): MediaRecord[] {
  const rows = database
    .query("SELECT * FROM media WHERE content_hash = ? AND status = 'active' ORDER BY imported_at ASC, id ASC")
    .all(contentHash) as MediaRow[];
  return rows.map(rowToMediaRecord);
}

export function quarantineMedia(
  database: Database,
  mediaId: number,
  quarantinePath: string,
  reason: string,
): void {
  database
    .query(
      `UPDATE media SET status = 'quarantined', quarantined_at = ?, quarantine_path = ?, quarantine_reason = ?
       WHERE id = ?`,
    )
    .run(new Date().toISOString(), quarantinePath, reason, mediaId);
}

export function restoreMedia(database: Database, mediaId: number, restoredPath: string): void {
  database
    .query(
      `UPDATE media SET status = 'active', quarantined_at = NULL, quarantine_path = NULL, quarantine_reason = NULL, path = ?
       WHERE id = ?`,
    )
    .run(restoredPath, mediaId);
}

export function insertDuplicateResolution(
  database: Database,
  input: { contentHash: string; keptMediaId: number; action: "deleted_extras" | "ignored"; notes?: string | null },
): void {
  database
    .query(
      "INSERT INTO duplicate_resolutions (content_hash, kept_media_id, action, resolved_at, notes) VALUES (?, ?, ?, ?, ?)",
    )
    .run(input.contentHash, input.keptMediaId, input.action, new Date().toISOString(), input.notes ?? null);
}

export function findMediaByPath(database: Database, path: string): MediaRecord | null {
  const row = database.query("SELECT * FROM media WHERE path = ?").get(path) as MediaRow | null;
  return row ? rowToMediaRecord(row) : null;
}

export function findActiveMediaByHash(database: Database, contentHash: string): MediaRecord | null {
  const row = database
    .query("SELECT * FROM media WHERE content_hash = ? AND status = 'active' LIMIT 1")
    .get(contentHash) as MediaRow | null;
  return row ? rowToMediaRecord(row) : null;
}

/** Filename+hash pairs of active media already indexed under a given relative directory, for collision resolution. */
export function findActiveMediaInDirectory(
  database: Database,
  relativeDir: string,
): Array<{ name: string; hash: string }> {
  const rows = database
    .query("SELECT filename, content_hash FROM media WHERE relative_path LIKE ? AND status = 'active'")
    .all(`${relativeDir}/%`) as Array<{ filename: string; content_hash: string }>;
  return rows.map((r) => ({ name: r.filename, hash: r.content_hash }));
}

export interface InsertMediaInput {
  path: string;
  relativePath: string;
  filename: string;
  extension: string;
  mediaType: MediaRecord["mediaType"];
  captureDate: string;
  captureDatetime: string | null;
  dateSource: MediaRecord["dateSource"];
  sizeBytes: number;
  contentHash: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  companionAaePath: string | null;
  sourcePath: string | null;
  importedAt: string | null;
  origin: "camera" | "other";
}

export function insertMedia(database: Database, input: InsertMediaInput): number {
  const result = database
    .query(
      `INSERT INTO media (
        path, relative_path, filename, extension, media_type,
        capture_date, capture_datetime, date_source, size_bytes,
        content_hash, content_hash_algo, width, height, duration_seconds,
        companion_aae_path, source_path, imported_at, indexed_at, origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.path,
      input.relativePath,
      input.filename,
      input.extension,
      input.mediaType,
      input.captureDate,
      input.captureDatetime,
      input.dateSource,
      input.sizeBytes,
      input.contentHash,
      HASH_ALGO,
      input.width,
      input.height,
      input.durationSeconds,
      input.companionAaePath,
      input.sourcePath,
      input.importedAt,
      new Date().toISOString(),
      input.origin,
    );
  return Number(result.lastInsertRowid);
}

// --- import_jobs / import_job_events -------------------------------------

export function createImportJob(
  database: Database,
  input: {
    jobType: "import" | "reindex" | "device_import";
    sourcePath?: string | null;
    deviceUdid?: string | null;
    deviceName?: string | null;
    deleteAfterVerify?: boolean;
  },
): number {
  const result = database
    .query(
      `INSERT INTO import_jobs (job_type, source_path, device_udid, device_name, delete_after_verify, status, started_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?)`,
    )
    .run(
      input.jobType,
      input.sourcePath ?? null,
      input.deviceUdid ?? null,
      input.deviceName ?? null,
      input.deleteAfterVerify ? 1 : 0,
      new Date().toISOString(),
    );
  return Number(result.lastInsertRowid);
}

interface ImportJobRow {
  id: number;
  job_type: string;
  source_path: string | null;
  device_udid: string | null;
  device_name: string | null;
  delete_after_verify: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  files_found: number;
  files_processed: number;
  files_imported: number;
  files_skipped_duplicate: number;
  files_errored: number;
  files_deleted_from_device: number;
  last_error: string | null;
}

function rowToImportJobRecord(row: ImportJobRow): ImportJobRecord {
  return {
    id: row.id,
    jobType: row.job_type as ImportJobRecord["jobType"],
    sourcePath: row.source_path,
    deviceUdid: row.device_udid,
    deviceName: row.device_name,
    deleteAfterVerify: row.delete_after_verify === 1,
    status: row.status as ImportJobRecord["status"],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    filesFound: row.files_found,
    filesProcessed: row.files_processed,
    filesImported: row.files_imported,
    filesSkippedDuplicate: row.files_skipped_duplicate,
    filesErrored: row.files_errored,
    filesDeletedFromDevice: row.files_deleted_from_device,
    lastError: row.last_error,
  };
}

// --- settings -------------------------------------------------------------

export function getSetting(database: Database, key: string): string | null {
  const row = database.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row ? row.value : null;
}

export function setSetting(database: Database, key: string, value: string): void {
  database
    .query(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, new Date().toISOString());
}

export function getImportJob(database: Database, jobId: number): ImportJobRecord | null {
  const row = database.query("SELECT * FROM import_jobs WHERE id = ?").get(jobId) as ImportJobRow | null;
  return row ? rowToImportJobRecord(row) : null;
}

/**
 * Returns the currently active (running/pending) job, if any. Used to guard
 * against starting two jobs concurrently — confirmed empirically that two
 * overlapping device-import jobs against the same phone can race each
 * other's afcclient sessions (one job's delete can interleave with another
 * job's copy of the same still-present files), and the same
 * read-existing-then-write collision-resolution pattern in import/reindex
 * jobs is vulnerable to the same class of race if two jobs touch the same
 * destination directory at once. Simplest safe fix for a personal tool:
 * only one job runs at a time, full stop.
 */
export function findActiveJob(database: Database): ImportJobRecord | null {
  const row = database
    .query("SELECT * FROM import_jobs WHERE status IN ('running', 'pending') ORDER BY id DESC LIMIT 1")
    .get() as ImportJobRow | null;
  return row ? rowToImportJobRecord(row) : null;
}

export function listImportJobs(database: Database, limit = 50): ImportJobRecord[] {
  const rows = database
    .query("SELECT * FROM import_jobs ORDER BY id DESC LIMIT ?")
    .all(limit) as ImportJobRow[];
  return rows.map(rowToImportJobRecord);
}

export function listImportJobEvents(
  database: Database,
  jobId: number,
  sinceId: number,
  limit: number,
): ImportJobEventRecord[] {
  const rows = database
    .query("SELECT * FROM import_job_events WHERE job_id = ? AND id > ? ORDER BY id ASC LIMIT ?")
    .all(jobId, sinceId, limit) as Array<{
    id: number;
    job_id: number;
    file_path: string;
    outcome: string;
    message: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    filePath: r.file_path,
    outcome: r.outcome as ImportJobEventRecord["outcome"],
    message: r.message,
    createdAt: r.created_at,
  }));
}

export function updateImportJob(
  database: Database,
  jobId: number,
  fields: Partial<{
    status: string;
    finishedAt: string;
    filesFound: number;
    filesProcessed: number;
    filesImported: number;
    filesSkippedDuplicate: number;
    filesErrored: number;
    filesDeletedFromDevice: number;
    lastError: string;
  }>,
): void {
  const columnMap: Record<string, string> = {
    status: "status",
    finishedAt: "finished_at",
    filesFound: "files_found",
    filesProcessed: "files_processed",
    filesImported: "files_imported",
    filesSkippedDuplicate: "files_skipped_duplicate",
    filesErrored: "files_errored",
    filesDeletedFromDevice: "files_deleted_from_device",
    lastError: "last_error",
  };
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const setClause = entries.map(([k]) => `${columnMap[k]} = ?`).join(", ");
  const values = entries.map(([, v]) => v as string | number);
  database.query(`UPDATE import_jobs SET ${setClause} WHERE id = ?`).run(...values, jobId);
}

export function incrementImportJobCounters(
  database: Database,
  jobId: number,
  fields: Partial<{
    filesProcessed: number;
    filesImported: number;
    filesSkippedDuplicate: number;
    filesErrored: number;
    filesDeletedFromDevice: number;
  }>,
): void {
  const columnMap: Record<string, string> = {
    filesProcessed: "files_processed",
    filesImported: "files_imported",
    filesSkippedDuplicate: "files_skipped_duplicate",
    filesErrored: "files_errored",
    filesDeletedFromDevice: "files_deleted_from_device",
  };
  for (const [key, delta] of Object.entries(fields)) {
    if (!delta) continue;
    database.query(`UPDATE import_jobs SET ${columnMap[key]} = ${columnMap[key]} + ? WHERE id = ?`).run(delta, jobId);
  }
}

// --- device_import_items --------------------------------------------------

interface DeviceImportItemRow {
  id: number;
  job_id: number;
  device_path: string;
  filename: string;
  expected_size_bytes: number;
  device_mtime_ms: number | null;
  local_temp_path: string | null;
  phase: string;
  media_id: number | null;
  last_error: string | null;
  updated_at: string;
}

function rowToDeviceImportItem(row: DeviceImportItemRow): DeviceImportItemRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    devicePath: row.device_path,
    filename: row.filename,
    expectedSizeBytes: row.expected_size_bytes,
    deviceMtimeMs: row.device_mtime_ms,
    localTempPath: row.local_temp_path,
    phase: row.phase as DeviceImportItemRecord["phase"],
    mediaId: row.media_id,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

/** Idempotent: uses INSERT OR IGNORE keyed on (job_id, device_path), so
 * re-listing the device on a resumed job never duplicates already-tracked items. */
export function createDeviceImportItems(
  database: Database,
  jobId: number,
  entries: Array<{ devicePath: string; filename: string; sizeBytes: number; deviceMtimeMs: number | null }>,
): void {
  const stmt = database.query(
    `INSERT OR IGNORE INTO device_import_items (job_id, device_path, filename, expected_size_bytes, device_mtime_ms, phase, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
  );
  const now = new Date().toISOString();
  database.transaction(() => {
    for (const entry of entries) {
      stmt.run(jobId, entry.devicePath, entry.filename, entry.sizeBytes, entry.deviceMtimeMs, now);
    }
  })();
}

export function getDeviceImportItems(
  database: Database,
  jobId: number,
  phases?: readonly string[],
): DeviceImportItemRecord[] {
  if (!phases || phases.length === 0) {
    const rows = database.query("SELECT * FROM device_import_items WHERE job_id = ?").all(jobId) as DeviceImportItemRow[];
    return rows.map(rowToDeviceImportItem);
  }
  const placeholders = phases.map(() => "?").join(", ");
  const rows = database
    .query(`SELECT * FROM device_import_items WHERE job_id = ? AND phase IN (${placeholders})`)
    .all(jobId, ...phases) as DeviceImportItemRow[];
  return rows.map(rowToDeviceImportItem);
}

export function setDeviceImportItemPhase(
  database: Database,
  id: number,
  phase: DeviceImportItemRecord["phase"],
  fields?: { localTempPath?: string | null; mediaId?: number | null; lastError?: string | null },
): void {
  database
    .query(
      `UPDATE device_import_items
       SET phase = ?, local_temp_path = COALESCE(?, local_temp_path), media_id = COALESCE(?, media_id),
           last_error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      phase,
      fields?.localTempPath ?? null,
      fields?.mediaId ?? null,
      fields?.lastError ?? null,
      new Date().toISOString(),
      id,
    );
}

export function logImportJobEvent(
  database: Database,
  jobId: number,
  filePath: string,
  outcome: "imported" | "skipped_duplicate" | "error",
  message: string | null,
): void {
  database
    .query("INSERT INTO import_job_events (job_id, file_path, outcome, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(jobId, filePath, outcome, message, new Date().toISOString());
}
