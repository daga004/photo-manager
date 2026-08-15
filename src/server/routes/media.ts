import { Database } from "bun:sqlite";
import { basename, join } from "node:path";
import { getMediaById, quarantineMedia, restoreMedia } from "../db.ts";
import { config } from "../config.ts";
import { safeMoveFile } from "../services/fsmove.ts";
import { nativeOpen } from "./openPath.ts";

export function makeMediaDetailHandler(db: Database) {
  return (req: Bun.BunRequest<"/api/media/:id">): Response => {
    const id = Number(req.params.id);
    const media = getMediaById(db, id);
    if (!media) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(media);
  };
}

export function makeMediaFullHandler(db: Database) {
  return async (req: Bun.BunRequest<"/api/media/:id/full">): Promise<Response> => {
    const id = Number(req.params.id);
    const media = getMediaById(db, id);
    if (!media) return Response.json({ error: "not found" }, { status: 404 });

    const file = Bun.file(media.path);
    if (!(await file.exists())) {
      return Response.json({ error: "file missing on disk" }, { status: 410 });
    }

    // new Response(Bun.file(...)) automatically handles an incoming Range
    // header correctly (verified: returns 206 + correct Content-Range for
    // both a 4.8GB test file's start and middle) — no manual byte-range
    // slicing needed. Accept-Ranges is added explicitly so video players
    // know seeking is supported before they try it.
    return new Response(file, {
      headers: { "Accept-Ranges": "bytes" },
    });
  };
}

/** Opens the original file in the host's default app (Preview/QuickTime/etc.)
 * via the OS. The file is already local, so this never downloads or streams it. */
export function makeMediaOpenHandler(db: Database) {
  return async (req: Bun.BunRequest<"/api/media/:id/open">): Promise<Response> => {
    const id = Number(req.params.id);
    const media = getMediaById(db, id);
    if (!media) return Response.json({ error: "not found" }, { status: 404 });
    if (!(await Bun.file(media.path).exists())) {
      return Response.json({ error: "file missing on disk" }, { status: 410 });
    }
    try {
      await nativeOpen(media.path);
      return Response.json({ opened: true });
    } catch (err) {
      return Response.json(
        { error: `could not open file with the OS: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 },
      );
    }
  };
}

/** Soft-deletes a single media file: moves it to the restorable "deleted"
 * quarantine (verified copy before the source is removed) and marks the row
 * quarantined. Reversible via the existing restore endpoint. */
export function makeMediaDeleteHandler(db: Database) {
  return async (req: Bun.BunRequest<"/api/media/:id/delete">): Promise<Response> => {
    const id = Number(req.params.id);
    const media = getMediaById(db, id);
    if (!media) return Response.json({ error: "not found" }, { status: 404 });
    if (media.status !== "active") {
      return Response.json({ error: "media is not active" }, { status: 400 });
    }
    try {
      const dest = join(config.quarantineDeletedDir, `${id}_${basename(media.path)}`);
      await safeMoveFile(media.path, dest);
      quarantineMedia(db, id, dest, "deleted from viewer");
      return Response.json({ deleted: true });
    } catch (err) {
      // safeMoveFile only unlinks after a verified copy, so a failure leaves the
      // original intact.
      return Response.json(
        { error: `delete failed (original kept): ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 },
      );
    }
  };
}

export function makeMediaRestoreHandler(db: Database) {
  return async (req: Bun.BunRequest<"/api/media/:id/restore">): Promise<Response> => {
    const id = Number(req.params.id);
    const media = getMediaById(db, id);
    if (!media) return Response.json({ error: "not found" }, { status: 404 });
    if (media.status !== "quarantined") {
      return Response.json({ error: "media is not quarantined" }, { status: 400 });
    }
    if (!media.quarantinePath) {
      return Response.json({ error: "missing quarantine_path, cannot restore" }, { status: 500 });
    }

    await safeMoveFile(media.quarantinePath, media.path);
    restoreMedia(db, id, media.path);
    return Response.json({ restored: true });
  };
}
