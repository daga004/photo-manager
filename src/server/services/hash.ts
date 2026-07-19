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
 * Note the byte size is part of the fingerprint, so two files with the same
 * fingerprint necessarily have the same size — a "same fingerprint, different
 * size" pair can't occur short of a SHA-256 collision. This is still only a
 * STRONG duplicate signal, not proof of equality (the un-sampled middle of two
 * large files could differ), so anything that would DELETE a file based on a
 * fingerprint match must confirm with verifyIdentical below.
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
 * Definitively determines whether two files are byte-for-byte identical. This
 * is the escalation step that makes sampled fingerprinting safe for the delete
 * path: a fingerprint collision (rare) is confirmed here before anything is
 * quarantined. It escalates cheapest-check-first:
 *
 *   1. compare byte sizes — unequal => definitely different, with ZERO reads;
 *   2. stream both files and compare chunk-by-chunk, returning false at the
 *      first differing byte, so a same-size-but-different pair reads only up to
 *      the first mismatch rather than both files end-to-end.
 *
 * A direct byte comparison (rather than comparing two full hashes) is used
 * deliberately: it's the unarguable ground truth for a destructive decision,
 * and it needs only one read of each file with early exit.
 */
export async function verifyIdentical(pathA: string, pathB: string): Promise<boolean> {
  const a = Bun.file(pathA);
  const b = Bun.file(pathB);
  if (a.size !== b.size) return false;
  const size = a.size;
  if (size === 0) return true;

  const ra = a.stream().getReader();
  const rb = b.stream().getReader();
  let leftA = new Uint8Array(0);
  let leftB = new Uint8Array(0);
  let compared = 0;

  while (compared < size) {
    const refills: Promise<void>[] = [];
    if (leftA.length === 0) refills.push(ra.read().then((r) => void (leftA = r.value ?? new Uint8Array(0))));
    if (leftB.length === 0) refills.push(rb.read().then((r) => void (leftB = r.value ?? new Uint8Array(0))));
    if (refills.length) await Promise.all(refills);

    // A stable file whose stat size we trust should never run dry early; if it
    // does (truncated mid-read), treat as not-identical rather than looping.
    if (leftA.length === 0 || leftB.length === 0) return false;

    const n = Math.min(leftA.length, leftB.length);
    for (let i = 0; i < n; i++) {
      if (leftA[i] !== leftB[i]) return false;
    }
    leftA = leftA.subarray(n);
    leftB = leftB.subarray(n);
    compared += n;
  }
  return true;
}
