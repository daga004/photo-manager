import { Database } from "bun:sqlite";
import { getMediaById } from "../db.ts";
import { ensureThumbnail } from "../services/thumbnails.ts";

export function makeThumbnailHandler(db: Database) {
  return async (req: Bun.BunRequest<"/api/media/:id/thumbnail">): Promise<Response> => {
    const id = Number(req.params.id);
    const media = getMediaById(db, id);
    if (!media) return Response.json({ error: "not found" }, { status: 404 });

    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch === media.contentHash) {
      return new Response(null, { status: 304 });
    }

    const result = await ensureThumbnail({
      contentHash: media.contentHash,
      sourcePath: media.path,
      mediaType: media.mediaType,
    });

    if (result.status === "error" || !result.path) {
      return Response.json({ error: result.error ?? "thumbnail generation failed" }, { status: 500 });
    }

    return new Response(Bun.file(result.path), {
      headers: {
        "Content-Type": "image/jpeg",
        ETag: media.contentHash,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  };
}
