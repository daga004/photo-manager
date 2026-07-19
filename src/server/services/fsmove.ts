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
