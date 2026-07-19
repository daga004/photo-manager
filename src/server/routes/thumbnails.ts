import { Database } from "bun:sqlite";
import { getMediaById } from "../db.ts";
import { ensureRenderedImage, type ImageVariant } from "../services/thumbnails.ts";

function makeRenderedImageHandler(db: Database, variant: ImageVariant) {
  return async (req: Bun.BunRequest<"/api/media/:id/thumbnail">): Promise<Response> => {
    const id = Number(req.params.id);
    const media = getMediaById(db, id);
    if (!media) return Response.json({ error: "not found" }, { status: 404 });

    const etag = `${variant}-${media.contentHash}`;
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304 });
    }

    const result = await ensureRenderedImage({
      contentHash: media.contentHash,
      sourcePath: media.path,
      mediaType: media.mediaType,
      variant,
    });

    if (result.status === "error" || !result.path) {
      return Response.json({ error: result.error ?? "image generation failed" }, { status: 500 });
    }

    return new Response(Bun.file(result.path), {
      headers: {
        "Content-Type": "image/jpeg",
        ETag: etag,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  };
}

export function makeThumbnailHandler(db: Database) {
  return makeRenderedImageHandler(db, "thumb");
}

export function makePreviewHandler(db: Database) {
  return makeRenderedImageHandler(db, "preview");
}
