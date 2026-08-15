import type { MediaType } from "./extensions.ts";

export type DateSource = "exif_datetime_original" | "exif_create_date" | "file_mtime";
export type MediaStatus = "active" | "quarantined";
export type ThumbnailStatus = "pending" | "done" | "error";

export interface MediaRecord {
  id: number;
  path: string;
  relativePath: string;
  filename: string;
  extension: string;
  mediaType: MediaType;
  captureDate: string; // YYYY-MM-DD
  captureDatetime: string | null;
  dateSource: DateSource;
  sizeBytes: number;
  contentHash: string;
  contentHashAlgo: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  companionAaePath: string | null;
  sourcePath: string | null;
  importedAt: string | null;
  indexedAt: string;
  status: MediaStatus;
  quarantinedAt: string | null;
  quarantinePath: string | null;
  quarantineReason: string | null;
  thumbnailStatus: ThumbnailStatus;
  thumbnailPath: string | null;
  isUndated: boolean;
  origin: "camera" | "other";
}

export type JobType = "import" | "reindex" | "device_import";
export type JobStatus = "pending" | "running" | "stalled" | "paused" | "completed" | "failed" | "cancelled";

export interface ImportJobRecord {
  id: number;
  jobType: JobType;
  sourcePath: string | null;
  deviceUdid: string | null;
  deviceName: string | null;
  deleteAfterVerify: boolean;
  status: JobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  filesFound: number;
  filesProcessed: number;
  filesImported: number;
  filesSkippedDuplicate: number;
  filesErrored: number;
  filesDeletedFromDevice: number;
  lastError: string | null;
  /** Live, in-flight transfer progress for a RUNNING import job. Attached by the
   * jobs route from an in-memory store (NOT a DB column) — it's high-frequency
   * and only meaningful while the job runs. Null/absent for idle or finished
   * jobs, and for job types that don't report it. */
  progress?: JobProgress | null;
}

/** A single file currently being copied into the library (live import progress). */
export interface ActiveTransfer {
  /** Destination filename (post-collision-allocation), for display. */
  filename: string;
  /** Destination directory the file is being placed into, relative to the
   * library root — the `photos|videos/YYYY/MM/DD` path. Lets the UI surface the
   * capture-date folders live, so a mis-dated file (e.g. a 2024 photo landing
   * under 2019) is obvious at a glance while importing. */
  destRelativeDir: string;
  sizeBytes: number;
  /** Bytes written so far for THIS file (enables a per-file mini progress bar
   * and a meaningful rate even while a single multi-GB file copies). */
  bytesCopied: number;
  startedAt: string; // ISO
}

/** Live progress snapshot for a running import job, merged into ImportJobRecord
 * by the jobs route. Held in an in-memory store keyed by jobId; not persisted. */
export interface JobProgress {
  /** Files currently being copied (up to COPY_CONCURRENCY of them). */
  activeTransfers: ActiveTransfer[];
  /** Cumulative bytes copied this job run (across all completed + active files). */
  bytesCopiedTotal: number;
  /** Smoothed aggregate throughput in bytes/second (rolling window). */
  bytesPerSecond: number;
  /** The most recently fully-imported file — lets the UI show a "just imported"
   * thumbnail (via /api/media/:id/thumbnail) as a lightweight preview. Null until
   * the first file completes; null for files that were quarantined as duplicates. */
  lastCompletedFilename: string | null;
  lastCompletedMediaId: number | null;
  updatedAt: string; // ISO
}

export type ImportJobEventOutcome = "imported" | "skipped_duplicate" | "error";

export interface ImportJobEventRecord {
  id: number;
  jobId: number;
  filePath: string;
  outcome: ImportJobEventOutcome;
  message: string | null;
  createdAt: string;
}

export type DeviceImportPhase =
  | "pending"
  | "copied"
  | "copy_failed"
  | "indexed"
  | "ready_to_delete"
  | "deleted"
  | "delete_failed";

export interface DeviceImportItemRecord {
  id: number;
  jobId: number;
  devicePath: string;
  filename: string;
  expectedSizeBytes: number;
  deviceMtimeMs: number | null;
  localTempPath: string | null;
  phase: DeviceImportPhase;
  mediaId: number | null;
  lastError: string | null;
  updatedAt: string;
}

export interface DuplicateResolutionRecord {
  id: number;
  contentHash: string;
  keptMediaId: number;
  action: "deleted_extras" | "ignored";
  resolvedAt: string;
  notes: string | null;
}

export interface DayAggregate {
  date: string;
  itemCount: number;
  photoCount: number;
  videoCount: number;
  totalSizeBytes: number;
}

export interface DayItem {
  id: number;
  filename: string;
  mediaType: MediaType;
  extension: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  thumbnailUrl: string;
}

export interface DuplicateGroup {
  contentHash: string;
  sizeBytes: number;
  count: number;
  items: Array<{
    id: number;
    path: string;
    filename: string;
    mediaType: MediaType;
    captureDate: string;
    importedAt: string | null;
    thumbnailUrl: string;
  }>;
}

export interface DeviceInfo {
  udid: string;
  name: string;
  iosVersion: string;
  connectionType: "usb" | "wifi";
}
