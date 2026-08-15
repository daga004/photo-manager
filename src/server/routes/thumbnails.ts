import { Database } from "bun:sqlite";
import { getMediaById, setThumbnailStatus } from "../db.ts";
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

    // A quarantined file's original path is empty (it was moved to quarantine);
    // render from the quarantine copy so the Recover view still shows thumbnails.
    const sourcePath =
      media.status === "quarantined" && media.quarantinePath ? media.quarantinePath : media.path;
    const result = await ensureRenderedImage({
      contentHash: media.contentHash,
      sourcePath,
      mediaType: media.mediaType,
      variant,
    });

    // Keep the index's record of where this file's thumbnail lives up to date,
    // whether it was just generated here or by the background pre-generator. Only
    // the "thumb" variant is tracked by thumbnail_status; "preview" is a separate
    // on-demand cache. Skip the write when nothing changed (the common cache-hit).
    if (variant === "thumb" && media.thumbnailStatus !== result.status) {
      setThumbnailStatus(db, id, result.status, result.path);
    }

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
