import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { getSetting, setSetting } from "../db.ts";
import { config, DEFAULT_LIBRARY_ROOT, getLibraryRoot, setLibraryRoot } from "../config.ts";

export const LIBRARY_ROOT_KEY = "library_root";

/**
 * Reads the persisted library root at startup (falling back to env/default)
 * and applies it, so every subsequent path resolution uses the configured
 * location. Call once, right after the DB is opened.
 */
export function loadLibraryRootFromSettings(db: Database): void {
  const stored = getSetting(db, LIBRARY_ROOT_KEY);
  if (stored) setLibraryRoot(stored);
}

export function makeSettingsGetHandler(db: Database) {
  return (_req: Request): Response => {
    const stored = getSetting(db, LIBRARY_ROOT_KEY);
    return Response.json({
      libraryRoot: getLibraryRoot(),
      isDefault: stored === null,
      defaultLibraryRoot: DEFAULT_LIBRARY_ROOT,
      dataDir: config.dataDir,
      photosDir: `${getLibraryRoot()}/photos`,
      videosDir: `${getLibraryRoot()}/videos`,
    });
  };
}

export function makeSettingsUpdateHandler(db: Database) {
  return async (req: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const libraryRoot = (body as { libraryRoot?: unknown }).libraryRoot;
    if (typeof libraryRoot !== "string" || libraryRoot.trim() === "") {
      return Response.json({ error: "libraryRoot is required" }, { status: 400 });
    }
    const trimmed = libraryRoot.trim();
    if (!trimmed.startsWith("/")) {
      return Response.json({ error: "libraryRoot must be an absolute path" }, { status: 400 });
    }
    if (!existsSync(trimmed) || !statSync(trimmed).isDirectory()) {
      return Response.json({ error: `Not an existing directory: ${trimmed}` }, { status: 400 });
    }

    setSetting(db, LIBRARY_ROOT_KEY, trimmed);
    setLibraryRoot(trimmed);
    return Response.json({ libraryRoot: getLibraryRoot() });
  };
}
