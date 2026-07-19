import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.ts";
import { THUMBNAIL_CONCURRENCY, THUMBNAIL_SIZE_PX } from "../../shared/constants.ts";
import type { MediaType } from "../../shared/extensions.ts";
import { Semaphore } from "./concurrency.ts";

const semaphore = new Semaphore(THUMBNAIL_CONCURRENCY);
const inFlight = new Map<string, Promise<ThumbnailResult>>();

export interface ThumbnailResult {
  status: "done" | "error";
  path: string | null;
  error?: string;
}

export function thumbnailCachePath(contentHash: string): string {
  const shard = contentHash.slice(0, 2);
  return join(config.thumbnailsDir, shard, `${contentHash}.jpg`);
}

/**
 * Generates (if not already cached) a JPEG thumbnail for a media file,
 * keyed by content hash so byte-identical files share one cached thumbnail.
 * Concurrent requests for the same hash await a single in-flight generation
 * rather than double-spawning sips/ffmpeg; a semaphore caps total concurrent
 * spawns so a large grid rendering at once doesn't fork-bomb the machine.
 */
export async function ensureThumbnail(params: {
  contentHash: string;
  sourcePath: string;
  mediaType: MediaType;
}): Promise<ThumbnailResult> {
  const dest = thumbnailCachePath(params.contentHash);

  if (await Bun.file(dest).exists()) {
    return { status: "done", path: dest };
  }

  const existing = inFlight.get(params.contentHash);
  if (existing) return existing;

  const promise = generate(params.sourcePath, params.mediaType, dest).finally(() => {
    inFlight.delete(params.contentHash);
  });
  inFlight.set(params.contentHash, promise);
  return promise;
}

async function generate(sourcePath: string, mediaType: MediaType, dest: string): Promise<ThumbnailResult> {
  const release = await semaphore.acquire();
  try {
    await mkdir(dirname(dest), { recursive: true });
    if (mediaType === "photo") {
      return await generatePhotoThumbnail(sourcePath, dest);
    }
    return await generateVideoThumbnail(sourcePath, dest);
  } finally {
    release();
  }
}

async function generatePhotoThumbnail(sourcePath: string, dest: string): Promise<ThumbnailResult> {
  // -s format jpeg is required: without it, sips silently writes the source
  // format's bytes into the .jpg-named file (confirmed with real HEIC input),
  // which browsers can't render.
  const sipsOk = await run([
    "sips",
    "-s",
    "format",
    "jpeg",
    "-Z",
    String(THUMBNAIL_SIZE_PX),
    sourcePath,
    "--out",
    dest,
  ]);
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

async function generateVideoThumbnail(sourcePath: string, dest: string): Promise<ThumbnailResult> {
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
      `scale=${THUMBNAIL_SIZE_PX}:-1`,
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
