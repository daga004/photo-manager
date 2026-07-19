import { Database } from "bun:sqlite";
import { basename, dirname, join } from "node:path";
import { stat } from "node:fs/promises";
import { findActiveMediaByHash, findActiveMediaInDirectory, insertMedia } from "../db.ts";
import { config } from "../config.ts";
import { baseNameNoExt, type MediaType } from "../../shared/extensions.ts";
import type { ExifMetadata } from "./exif.ts";
import { resolveCaptureDate } from "./dateFallback.ts";
import { computeDestinationRelativePath } from "./paths.ts";
import { resolveCollision } from "./collision.ts";
import { safeMoveFile } from "./fsmove.ts";

export type PlacementResult =
  | { kind: "duplicate"; matchedName: string }
  | { kind: "indexed"; mediaId: number };

export interface PlaceAndIndexParams {
  /** An already-local file (on this machine) to move into the library. */
  localSourcePath: string;
  filename: string;
  mediaType: MediaType;
  extension: string;
  hash: string;
  meta: ExifMetadata | undefined;
  /** Recorded as media.source_path — an audit trail of where this came from. */
  sourcePathForAudit: string;
  importedAt: string | null;
  /** Local path to a companion .AAE sidecar, if any (folder-import only). */
  companionAaePath?: string | null;
}

/**
 * Shared placement pipeline used by both folder import and device (iPhone)
 * import: global-hash dedup check, capture-date resolution, destination
 * computation, collision handling, the safe move itself, and the `media`
 * row insert. The two callers differ only in how they got a local file to
 * hand in here (already on disk vs freshly copied off a device) and in what
 * they do with their *source* on a duplicate (quarantine vs discard a scratch
 * temp copy) — that decision stays with the caller.
 */
export async function placeAndIndexFile(db: Database, params: PlaceAndIndexParams): Promise<PlacementResult> {
  const existingByHash = findActiveMediaByHash(db, params.hash);
  if (existingByHash) {
    return { kind: "duplicate", matchedName: existingByHash.filename };
  }

  const srcStat = await stat(params.localSourcePath);
  const { captureDate, captureDatetime, dateSource } = resolveCaptureDate({
    dateTimeOriginal: params.meta?.dateTimeOriginal,
    createDate: params.meta?.createDate,
    fileMtimeMs: srcStat.mtimeMs,
  });

  const provisionalRelativePath = computeDestinationRelativePath(params.mediaType, captureDate, params.filename);
  const destRelativeDir = dirname(provisionalRelativePath);
  const existingEntries = findActiveMediaInDirectory(db, destRelativeDir);
  const collision = resolveCollision(params.filename, params.hash, existingEntries);

  if (collision.kind === "duplicate") {
    return { kind: "duplicate", matchedName: collision.matchedName };
  }

  const finalFilename = collision.filename;
  const destRelativePath = join(destRelativeDir, finalFilename);
  const destAbsolutePath = join(config.libraryRoot, destRelativePath);

  await safeMoveFile(params.localSourcePath, destAbsolutePath);

  let companionRelativePath: string | null = null;
  if (params.companionAaePath) {
    try {
      const companionSourceName = basename(params.companionAaePath);
      const companionExt = companionSourceName.slice(companionSourceName.lastIndexOf("."));
      const companionDestName = baseNameNoExt(finalFilename) + companionExt;
      const companionDestRelative = join(destRelativeDir, companionDestName);
      await safeMoveFile(params.companionAaePath, join(config.libraryRoot, companionDestRelative));
      companionRelativePath = companionDestRelative;
    } catch {
      // Non-fatal: the main file is already safely placed; the sidecar just
      // stays behind unmoved rather than failing the whole import.
    }
  }

  const mediaId = insertMedia(db, {
    path: destAbsolutePath,
    relativePath: destRelativePath,
    filename: finalFilename,
    extension: params.extension,
    mediaType: params.mediaType,
    captureDate,
    captureDatetime,
    dateSource,
    sizeBytes: srcStat.size,
    contentHash: params.hash,
    width: params.meta?.imageWidth ?? null,
    height: params.meta?.imageHeight ?? null,
    durationSeconds: params.meta?.duration ?? null,
    companionAaePath: companionRelativePath,
    sourcePath: params.sourcePathForAudit,
    importedAt: params.importedAt,
  });

  return { kind: "indexed", mediaId };
}
