import { join } from "node:path";

const libraryRoot = process.env.PHOTO_MANAGER_LIBRARY_ROOT ?? "/Volumes/nas";
const dataDir = process.env.PHOTO_MANAGER_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");

export const config = {
  libraryRoot,
  photosDir: join(libraryRoot, "photos"),
  videosDir: join(libraryRoot, "videos"),
  dataDir,
  dbPath: join(dataDir, "index.sqlite"),
  thumbnailsDir: join(dataDir, "thumbnails"),
  quarantineDuplicatesDir: join(dataDir, "quarantine", "duplicates"),
  quarantineImportDuplicatesDir: join(dataDir, "quarantine", "import-duplicates"),
  port: Number(process.env.PHOTO_MANAGER_PORT ?? 3000),
  // How long (ms) a running job may go without a progress update before the
  // UI treats it as stalled rather than actively working.
  jobStallTimeoutMs: Number(process.env.PHOTO_MANAGER_JOB_STALL_MS ?? 30_000),
} as const;
