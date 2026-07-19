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
