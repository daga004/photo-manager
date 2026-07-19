-- Add 'paused' to the import_jobs.status CHECK constraint.
--
-- SQLite can't ALTER a CHECK constraint in place, so this is the standard
-- create-new / copy / drop-old / rename table rebuild. It's safe against the
-- foreign keys in import_job_events and device_import_items because migrations
-- run with foreign_keys OFF (see db.ts getDb) — enforcement is turned on only
-- after all migrations apply.
CREATE TABLE import_jobs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL CHECK (job_type IN ('import','reindex','device_import')),
  source_path TEXT,
  device_udid TEXT,
  device_name TEXT,
  delete_after_verify INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','stalled','paused','completed','failed','cancelled')),
  started_at TEXT,
  finished_at TEXT,
  files_found INTEGER NOT NULL DEFAULT 0,
  files_processed INTEGER NOT NULL DEFAULT 0,
  files_imported INTEGER NOT NULL DEFAULT 0,
  files_skipped_duplicate INTEGER NOT NULL DEFAULT 0,
  files_errored INTEGER NOT NULL DEFAULT 0,
  files_deleted_from_device INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

INSERT INTO import_jobs_new SELECT * FROM import_jobs;
DROP TABLE import_jobs;
ALTER TABLE import_jobs_new RENAME TO import_jobs;
