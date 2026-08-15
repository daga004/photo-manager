import { mkdir, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Copies `sourcePath` to `destPath` (works across filesystems/volumes, unlike
 * fs.rename which throws EXDEV), verifies the destination's byte size matches
 * the source, and only then deletes the source. If the process dies between
 * the copy and the size check, the source is simply still there on retry —
 * never deleted before a verified copy exists.
 */
export async function safeMoveFile(sourcePath: string, destPath: string): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });
  const srcStat = await stat(sourcePath);
  await Bun.write(destPath, Bun.file(sourcePath));
  const destStat = await stat(destPath);
  if (destStat.size !== srcStat.size) {
    throw new Error(
      `Copy verification failed for ${destPath}: expected ${srcStat.size} bytes, got ${destStat.size}`,
    );
  }
  await unlink(sourcePath);
}

/** Flush the destination sink roughly every this-many buffered bytes, to bound
 * memory while streaming a large file rather than letting the whole thing queue. */
const STREAM_FLUSH_BYTES = 4 * 1024 * 1024;

/**
 * Streaming variant of {@link safeMoveFile} that reports copy progress as it
 * goes, for live per-file transfer bars during a parallel import. It preserves
 * safeMoveFile's exact durability contract — make the dest dir, copy fully,
 * verify the destination byte size equals the source, and only THEN unlink the
 * source — so a crash mid-copy never destroys a source before a verified copy
 * exists. It differs only in HOW it copies: reading the source as a stream and
 * writing chunk-by-chunk (via a Bun FileSink) so it can invoke `onBytes` with
 * each chunk's length, instead of the single opaque `Bun.write` used by
 * safeMoveFile. `onBytes` reflects bytes READ from the source; the final size
 * verification is what guarantees they were also durably written.
 */
export async function safeMoveFileStreamed(
  sourcePath: string,
  destPath: string,
  onBytes?: (chunkLen: number) => void,
): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });
  const srcStat = await stat(sourcePath);

  const writer = Bun.file(destPath).writer();
  let bufferedSinceFlush = 0;
  try {
    const reader = Bun.file(sourcePath).stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      writer.write(value);
      onBytes?.(value.byteLength);
      bufferedSinceFlush += value.byteLength;
      if (bufferedSinceFlush >= STREAM_FLUSH_BYTES) {
        await writer.flush();
        bufferedSinceFlush = 0;
      }
    }
    await writer.end(); // flushes remaining buffered bytes and closes the file
  } catch (err) {
    // Best-effort close so we don't leak the descriptor; the source is left
    // untouched (never unlinked here), so the move can simply be retried.
    try {
      await writer.end();
    } catch {
      // already errored — nothing more to do
    }
    throw err;
  }

  const destStat = await stat(destPath);
  if (destStat.size !== srcStat.size) {
    throw new Error(
      `Copy verification failed for ${destPath}: expected ${srcStat.size} bytes, got ${destStat.size}`,
    );
  }
  await unlink(sourcePath);
}
