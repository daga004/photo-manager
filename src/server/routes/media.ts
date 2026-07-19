import { Database } from "bun:sqlite";
import { getMediaById, restoreMedia } from "../db.ts";
import { safeMoveFile } from "../services/fsmove.ts";

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
