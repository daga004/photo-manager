/**
 * Streams the file through SHA-256 without loading it fully into memory —
 * important for multi-GB video files. `content_hash_algo` is stored alongside
 * the hash in the DB so a future migration to a faster algorithm (e.g. BLAKE3)
 * wouldn't require reinterpreting existing values.
 */
export async function hashFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
  }
  return hasher.digest("hex");
}
