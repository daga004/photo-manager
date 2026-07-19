CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  extension TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo','video')),
  capture_date TEXT NOT NULL,
  capture_datetime TEXT,
  date_source TEXT NOT NULL CHECK (date_source IN ('exif_datetime_original','exif_create_date','file_mtime')),
  size_bytes INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  content_hash_algo TEXT NOT NULL DEFAULT 'sha256',
  width INTEGER,
  height INTEGER,
  duration_seconds REAL,
  companion_aae_path TEXT,
  source_path TEXT,
  imported_at TEXT,
  indexed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','quarantined')),
  quarantined_at TEXT,
  quarantine_path TEXT,
  quarantine_reason TEXT,
  thumbnail_status TEXT NOT NULL DEFAULT 'pending' CHECK (thumbnail_status IN ('pending','done','error')),
  thumbnail_path TEXT
);
CREATE INDEX idx_media_hash ON media(content_hash);
CREATE INDEX idx_media_capture_date ON media(capture_date);
CREATE INDEX idx_media_status_date ON media(status, capture_date);

CREATE TABLE import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL CHECK (job_type IN ('import','reindex','device_import')),
  source_path TEXT,
  device_udid TEXT,
  device_name TEXT,
  delete_after_verify INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','stalled','completed','failed','cancelled')),
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

CREATE TABLE import_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES import_jobs(id),
  file_path TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('imported','skipped_duplicate','error')),
  message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_import_job_events_job ON import_job_events(job_id);

CREATE TABLE device_import_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES import_jobs(id),
  device_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  expected_size_bytes INTEGER NOT NULL,
  local_temp_path TEXT,
  phase TEXT NOT NULL DEFAULT 'pending' CHECK (phase IN
    ('pending','copied','copy_failed','indexed','ready_to_delete','deleted','delete_failed')),
  media_id INTEGER REFERENCES media(id),
  last_error TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, device_path)
);
CREATE INDEX idx_device_import_items_job_phase ON device_import_items(job_id, phase);

CREATE TABLE duplicate_resolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT NOT NULL,
  kept_media_id INTEGER NOT NULL REFERENCES media(id),
  action TEXT NOT NULL CHECK (action IN ('deleted_extras','ignored')),
  resolved_at TEXT NOT NULL,
  notes TEXT
);
CREATE INDEX idx_duplicate_resolutions_hash ON duplicate_resolutions(content_hash);
