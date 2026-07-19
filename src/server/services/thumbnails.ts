import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.ts";
import { PREVIEW_SIZE_PX, THUMBNAIL_CONCURRENCY, THUMBNAIL_SIZE_PX } from "../../shared/constants.ts";
import type { MediaType } from "../../shared/extensions.ts";
import { Semaphore } from "./concurrency.ts";

const semaphore = new Semaphore(THUMBNAIL_CONCURRENCY);
const inFlight = new Map<string, Promise<RenderResult>>();

export interface RenderResult {
  status: "done" | "error";
  path: string | null;
  error?: string;
}

/**
 * Rendered-image size variants, both cached on disk as browser-renderable
 * JPEGs keyed by content hash:
 *  - "thumb"   — small grid tile (fast, many at once);
 *  - "preview" — screen-resolution image for the full viewer. Serving this
 *    instead of the raw original is the big win over a network share: a
 *    ~2048px JPEG is a few hundred KB vs tens of MB, and it renders in every
 *    browser (HEIC/RAW originals don't). Full-res original is only fetched on
 *    an explicit "view original".
 */
export type ImageVariant = "thumb" | "preview";

const VARIANT_SIZE: Record<ImageVariant, number> = {
  thumb: THUMBNAIL_SIZE_PX,
  preview: PREVIEW_SIZE_PX,
};

export function renderedCachePath(contentHash: string, variant: ImageVariant): string {
  const shard = contentHash.slice(0, 2);
  return join(config.thumbnailsDir, variant, shard, `${contentHash}.jpg`);
}

/**
 * Generates (if not already cached) a JPEG rendition of a media file at the
 * requested size, keyed by content hash so byte-identical files share one
 * cached file. Concurrent requests for the same hash+variant await a single
 * in-flight generation rather than double-spawning sips/ffmpeg; a semaphore
 * caps total concurrent spawns so a grid rendering at once doesn't fork-bomb.
 */
export async function ensureRenderedImage(params: {
  contentHash: string;
  sourcePath: string;
  mediaType: MediaType;
  variant: ImageVariant;
}): Promise<RenderResult> {
  const dest = renderedCachePath(params.contentHash, params.variant);

  if (await Bun.file(dest).exists()) {
    return { status: "done", path: dest };
  }

  const key = `${params.variant}:${params.contentHash}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const size = VARIANT_SIZE[params.variant];
  const promise = generate(params.sourcePath, params.mediaType, dest, size).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

async function generate(
  sourcePath: string,
  mediaType: MediaType,
  dest: string,
  size: number,
): Promise<RenderResult> {
  const release = await semaphore.acquire();
  try {
    await mkdir(dirname(dest), { recursive: true });
    if (mediaType === "photo") {
      return await generatePhoto(sourcePath, dest, size);
    }
    return await generateVideoPoster(sourcePath, dest, size);
  } finally {
    release();
  }
}

async function generatePhoto(sourcePath: string, dest: string, size: number): Promise<RenderResult> {
  // -s format jpeg is required: without it, sips silently writes the source
  // format's bytes into the .jpg-named file (confirmed with real HEIC input),
  // which browsers can't render.
  const sipsOk = await run(["sips", "-s", "format", "jpeg", "-Z", String(size), sourcePath, "--out", dest]);
  if (sipsOk) return { status: "done", path: dest };

  // Fallback for formats sips can't handle: pull an embedded preview via exiftool.
  const proc = Bun.spawn(["exiftool", "-b", "-PreviewImage", sourcePath], { stdout: "pipe", stderr: "pipe" });
  const bytes = await new Response(proc.stdout).arrayBuffer();
  const exitCode = await proc.exited;
  if (exitCode === 0 && bytes.byteLength > 0) {
    await Bun.write(dest, bytes);
    return { status: "done", path: dest };
  }

  return { status: "error", path: null, error: "sips and exiftool preview extraction both failed" };
}

async function generateVideoPoster(sourcePath: string, dest: string, size: number): Promise<RenderResult> {
  // Try a 1s-in poster frame first; very short clips have no frame at 1s, so
  // fall back to the very first frame.
  for (const seekSeconds of ["00:00:01", "00:00:00"]) {
    const ok = await run([
      "ffmpeg",
      "-y",
      "-ss",
      seekSeconds,
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      "-update",
      "1",
      "-vf",
      `scale=${size}:-1`,
      dest,
    ]);
    if (ok) return { status: "done", path: dest };
  }
  return { status: "error", path: null, error: "ffmpeg poster-frame extraction failed" };
}

async function run(cmd: string[]): Promise<boolean> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  const exitCode = await proc.exited;
  return exitCode === 0;
}
