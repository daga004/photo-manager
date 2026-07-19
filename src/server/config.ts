import { join } from "node:path";

const dataDir = process.env.PHOTO_MANAGER_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");

/**
 * Static configuration known before the database opens. The library root is
 * NOT here — it's user-configurable and stored in the DB (see settings + the
 * getLibraryRoot/setLibraryRoot functions below), so it can't be resolved
 * until after getDb(). Data dir, db path, and port must be known first (the DB
 * lives under dataDir), so those stay env/default-driven.
 */
export const config = {
  dataDir,
  dbPath: join(dataDir, "index.sqlite"),
  thumbnailsDir: join(dataDir, "thumbnails"),
  quarantineDuplicatesDir: join(dataDir, "quarantine", "duplicates"),
  quarantineImportDuplicatesDir: join(dataDir, "quarantine", "import-duplicates"),
  port: Number(process.env.PHOTO_MANAGER_PORT ?? 3000),
} as const;

/** The library root falls back to the env var, then a sensible default, until
 * a persisted setting overrides it via setLibraryRoot() at startup. */
export const DEFAULT_LIBRARY_ROOT = process.env.PHOTO_MANAGER_LIBRARY_ROOT ?? "/Volumes/nas";

let libraryRoot = DEFAULT_LIBRARY_ROOT;

export function getLibraryRoot(): string {
  return libraryRoot;
}

export function setLibraryRoot(root: string): void {
  libraryRoot = root;
}

export function getPhotosDir(): string {
  return join(libraryRoot, "photos");
}

export function getVideosDir(): string {
  return join(libraryRoot, "videos");
}
