import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { stat } from "node:fs/promises";
import { findActiveMediaByHash, findActiveMediaInDirectory } from "../db.ts";
import type { DateSource } from "../../shared/types.ts";
import type { MediaType } from "../../shared/extensions.ts";
import { originFromMeta, type ExifMetadata } from "./exif.ts";
import { resolveCaptureDate } from "./dateFallback.ts";
import { computeDestinationRelativePath } from "./paths.ts";
import { allocateFilename } from "./collision.ts";
import { verifyIdentical } from "./hash.ts";
import type { ScannedFile } from "./scanner.ts";

/**
 * The import pipeline is split into a PLAN pass and an EXECUTE pass. The plan
 * pass decides, up front, the final destination filename for every file in the
 * batch (and which files are duplicates that won't be imported at all). Doing
 * every filename allocation in one deterministic, single-threaded pass is what
 * lets the execute pass then move files with real CONCURRENCY: the old
 * sequential placement existed ONLY because two files landing in the same
 * destination directory could otherwise race on the same free-name allocation.
 * With all names reserved before any move starts, that race is gone.
 *
 * `planAllocations` is the PURE core of the plan pass (no I/O, fully
 * deterministic) so it can be unit-tested in isolation; `buildImportPlan` is
 * the async wrapper that gathers its inputs (dates, dedup checks, existing
 * directory contents) and joins its output back with everything the executor
 * needs to actually move + index each file.
 */

/** One file's planning input, as handed to the pure allocator. `ref` maps each
 * op back to its originating file so the executor can recover source path etc. */
export interface AllocInput {
  ref: number; // caller's index, to map the op back to its file
  filename: string; // candidate destination filename (source basename)
  destRelativeDir: string; // e.g. "photos/2026/08/15"
  duplicateOf:
    | { kind: "library"; matchedName: string } // byte-identical to a file already in the library
    | { kind: "batch"; matchedRef: number } // byte-identical to an earlier file in THIS batch
    | null;
}

/** One decision emitted by the pure allocator, in the same order as its inputs. */
export type AllocOp =
  | { action: "import"; ref: number; destRelativeDir: string; destFilename: string }
  | { action: "quarantine_duplicate"; ref: number; matchedName: string }
  | { action: "skip_intrabatch_duplicate"; ref: number; matchedRef: number };

/**
 * Pure destination-name allocator. Given each file's candidate name, target
 * directory, and pre-computed duplicate status, decides the final op for every
 * file — reserving a unique name for each genuine import so that no two imports
 * in the same directory can ever collide.
 *
 * Contract (relied on by tests — do not change without updating them):
 *  - Inputs are processed in array order; ops are returned in that same order.
 *  - `reservedByDir` seeds each directory's reserved-name set (once, on first
 *    encounter) from `existingNamesByDir` — i.e. the names already on disk in
 *    the library for that directory — so allocations avoid clashing with files
 *    already indexed there, not just with others in this batch.
 *  - A `library` duplicate reserves NOTHING (it's quarantined, never imported).
 *  - A `batch` duplicate reserves NOTHING (it's skipped as a same-import dup).
 *  - A non-duplicate allocates a free name via `allocateFilename` against the
 *    reserved set, then ADDS that name to the set before moving on, so the next
 *    same-named, different-content file in the same dir gets `__dup2`, etc.
 */
export function planAllocations(
  inputs: AllocInput[],
  existingNamesByDir: Map<string, Iterable<string>>,
): AllocOp[] {
  const ops: AllocOp[] = [];
  const reservedByDir = new Map<string, Set<string>>();

  const reservedFor = (dir: string): Set<string> => {
    let set = reservedByDir.get(dir);
    if (!set) {
      set = new Set(existingNamesByDir.get(dir) ?? []);
      reservedByDir.set(dir, set);
    }
    return set;
  };

  for (const input of inputs) {
    if (input.duplicateOf?.kind === "library") {
      ops.push({ action: "quarantine_duplicate", ref: input.ref, matchedName: input.duplicateOf.matchedName });
      continue;
    }
    if (input.duplicateOf?.kind === "batch") {
      ops.push({ action: "skip_intrabatch_duplicate", ref: input.ref, matchedRef: input.duplicateOf.matchedRef });
      continue;
    }

    const reserved = reservedFor(input.destRelativeDir);
    const destFilename = allocateFilename(input.filename, reserved);
    reserved.add(destFilename);
    ops.push({ action: "import", ref: input.ref, destRelativeDir: input.destRelativeDir, destFilename });
  }

  return ops;
}

/** One file entering the plan pass: the scanned file plus its already-computed
 * sampled fingerprint and (optional) extracted EXIF metadata. */
export interface PlanFileInput {
  file: ScannedFile;
  fingerprint: string;
  meta: ExifMetadata | undefined;
}

/**
 * A fully-resolved import operation: the pure allocator's decision joined with
 * everything the executor needs to carry it out without re-deriving anything.
 * Every variant carries the source path, size, and companion sidecar so the
 * executor can move (and, for duplicates, quarantine) the source; the `import`
 * variant additionally carries the resolved destination + all `media` columns.
 */
export type PlannedOp =
  | {
      action: "import";
      sourcePath: string;
      filename: string; // original source basename (for logging)
      sizeBytes: number;
      mediaType: MediaType;
      extension: string;
      meta: ExifMetadata | undefined;
      origin: "camera" | "other";
      companionAaePath: string | null;
      fingerprint: string;
      captureDate: string;
      captureDatetime: string | null;
      dateSource: DateSource;
      destRelativeDir: string;
      destFilename: string;
    }
  | {
      action: "quarantine_duplicate";
      sourcePath: string;
      filename: string;
      sizeBytes: number;
      companionAaePath: string | null;
      matchedName: string;
    }
  | {
      action: "skip_intrabatch_duplicate";
      sourcePath: string;
      filename: string;
      sizeBytes: number;
      companionAaePath: string | null;
      matchedRef: number;
      /** Original filename of the earlier same-import file this one duplicates,
       * purely for a human-readable event message. */
      matchedName: string;
    };

/**
 * Async plan builder. For each input it resolves the capture date (EXIF meta,
 * falling back to the source's mtime) and destination directory, then decides
 * `duplicateOf`:
 *
 *   1. LIBRARY duplicate — a fingerprint hit in the library escalated to a TRUE
 *      byte-for-byte match (a sampled-fingerprint hit alone is only a candidate;
 *      see hash.ts). Only a verified match counts, else it's treated as new.
 *   2. In-BATCH duplicate — byte-identical to an EARLIER non-library-duplicate
 *      file in this same batch (tracked by fingerprint, escalated the same way).
 *      This is what stops two identical NEW files in one import from both being
 *      imported now that placement is parallel rather than insert-before-check.
 *   3. Otherwise new.
 *
 * It gathers existing indexed filenames per distinct destination directory,
 * hands everything to the pure `planAllocations`, and joins the resulting ops
 * back with per-file execution data. Processing is strictly sequential and in
 * array order — the in-batch dedup and the deterministic name allocation both
 * depend on a stable "earlier vs later" ordering.
 */
export async function buildImportPlan(db: Database, inputs: PlanFileInput[]): Promise<PlannedOp[]> {
  // Per-file data indexed by ref, computed once and reused when joining ops.
  interface Resolved {
    input: PlanFileInput;
    sizeBytes: number;
    captureDate: string;
    captureDatetime: string | null;
    dateSource: DateSource;
    destRelativeDir: string;
  }
  const resolved: Resolved[] = new Array(inputs.length);
  const allocInputs: AllocInput[] = new Array(inputs.length);

  // Earlier NON-library-duplicate files in this batch, keyed by fingerprint, so
  // a later identical file can be caught as an in-batch duplicate. Library
  // duplicates and batch duplicates are intentionally NOT tracked here — only a
  // genuinely-importing file is a valid target for a later file to dedup against.
  const batchByFingerprint = new Map<string, { ref: number; path: string }>();

  for (let ref = 0; ref < inputs.length; ref++) {
    const input = inputs[ref] as PlanFileInput;
    const { file, fingerprint, meta } = input;

    const srcStat = await stat(file.absolutePath);
    const { captureDate, captureDatetime, dateSource } = resolveCaptureDate({
      dateTimeOriginal: meta?.dateTimeOriginal,
      createDate: meta?.createDate,
      fileMtimeMs: srcStat.mtimeMs,
    });
    const destRelativeDir = dirname(
      computeDestinationRelativePath(file.mediaType, captureDate, file.filename),
    );

    resolved[ref] = {
      input,
      sizeBytes: srcStat.size,
      captureDate,
      captureDatetime,
      dateSource,
      destRelativeDir,
    };

    // 1) Library duplicate? Fingerprint candidate escalated to a true byte match.
    let duplicateOf: AllocInput["duplicateOf"] = null;
    const existingByHash = findActiveMediaByHash(db, fingerprint);
    if (existingByHash && (await verifyIdentical(file.absolutePath, existingByHash.path))) {
      duplicateOf = { kind: "library", matchedName: existingByHash.filename };
    } else {
      // 2) In-batch duplicate? Same fingerprint as an earlier importing file,
      //    escalated to a true byte match against that earlier source.
      const earlier = batchByFingerprint.get(fingerprint);
      if (earlier && (await verifyIdentical(file.absolutePath, earlier.path))) {
        duplicateOf = { kind: "batch", matchedRef: earlier.ref };
      } else {
        // 3) New: register it as a dedup target for later files in this batch.
        //    Only the first-seen path per fingerprint is kept — sufficient since
        //    all files sharing it are byte-identical when it's a real duplicate.
        if (!batchByFingerprint.has(fingerprint)) {
          batchByFingerprint.set(fingerprint, { ref, path: file.absolutePath });
        }
      }
    }

    allocInputs[ref] = { ref, filename: file.filename, destRelativeDir, duplicateOf };
  }

  // Seed each distinct destination directory's reserved names from what's
  // already indexed there, so allocations avoid names already on disk.
  const existingNamesByDir = new Map<string, Iterable<string>>();
  for (const r of resolved) {
    if (existingNamesByDir.has(r.destRelativeDir)) continue;
    existingNamesByDir.set(
      r.destRelativeDir,
      findActiveMediaInDirectory(db, r.destRelativeDir).map((e) => e.name),
    );
  }

  const ops = planAllocations(allocInputs, existingNamesByDir);

  // Join each pure op with the execution data captured for its ref.
  return ops.map((op): PlannedOp => {
    const r = resolved[op.ref] as Resolved;
    const { file, meta } = r.input;
    if (op.action === "import") {
      return {
        action: "import",
        sourcePath: file.absolutePath,
        filename: file.filename,
        sizeBytes: r.sizeBytes,
        mediaType: file.mediaType,
        extension: file.extension,
        meta,
        origin: originFromMeta(meta),
        companionAaePath: file.companionAaePath,
        fingerprint: r.input.fingerprint,
        captureDate: r.captureDate,
        captureDatetime: r.captureDatetime,
        dateSource: r.dateSource,
        destRelativeDir: op.destRelativeDir,
        destFilename: op.destFilename,
      };
    }
    if (op.action === "quarantine_duplicate") {
      return {
        action: "quarantine_duplicate",
        sourcePath: file.absolutePath,
        filename: file.filename,
        sizeBytes: r.sizeBytes,
        companionAaePath: file.companionAaePath,
        matchedName: op.matchedName,
      };
    }
    // skip_intrabatch_duplicate
    const matched = resolved[op.matchedRef] as Resolved;
    return {
      action: "skip_intrabatch_duplicate",
      sourcePath: file.absolutePath,
      filename: file.filename,
      sizeBytes: r.sizeBytes,
      companionAaePath: file.companionAaePath,
      matchedRef: op.matchedRef,
      matchedName: matched.input.file.filename,
    };
  });
}
