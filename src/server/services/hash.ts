import { SAMPLE_CHUNK_BYTES } from "../../shared/constants.ts";

/**
 * A fast, size-independent content fingerprint: sha256 over the file's byte
 * size plus its first and last `SAMPLE_CHUNK_BYTES`. Reads a flat ~128KB no
 * matter how large the file is, so fingerprinting a 469GB library over a slow
 * network share takes minutes instead of hours (the read, not the CPU hash,
 * is the bottleneck — see the imohash algorithm for the same idea).
 *
 * Files at or below 2 chunks are hashed in full — it's already cheap, and it
 * makes small files (screenshots, etc.) exact with zero collision risk.
 *
 * This is a STRONG duplicate signal (two distinct real photos/videos
 * essentially never share size + head + tail), but not a proof of equality:
 * anything that would DELETE a file based on a fingerprint match must first
 * confirm with fullHash/verifyIdentical below.
 */
export async function sampledFingerprint(path: string): Promise<string> {
  const file = Bun.file(path);
  const size = file.size;
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`${size}:`);

  if (size <= 2 * SAMPLE_CHUNK_BYTES) {
    hasher.update(new Uint8Array(await file.arrayBuffer()));
  } else {
    hasher.update(new Uint8Array(await file.slice(0, SAMPLE_CHUNK_BYTES).arrayBuffer()));
    hasher.update(new Uint8Array(await file.slice(size - SAMPLE_CHUNK_BYTES, size).arrayBuffer()));
  }
  return hasher.digest("hex");
}

/**
 * Full-content sha256, streamed so it never loads the whole file into memory.
 * Used only to VERIFY a small set of fingerprint-collision candidates before
 * a destructive action — never for bulk indexing (that's what
 * sampledFingerprint is for).
 */
export async function fullHash(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
  }
  return hasher.digest("hex");
}

/**
 * Returns true only if BOTH files are byte-for-byte identical, determined by
 * comparing their full-content hashes. This is the escalation step that makes
 * sampled fingerprinting safe for the delete path: a fingerprint collision
 * (rare) is confirmed here before anything is quarantined.
 */
export async function verifyIdentical(pathA: string, pathB: string): Promise<boolean> {
  const [a, b] = await Promise.all([fullHash(pathA), fullHash(pathB)]);
  return a === b;
}
