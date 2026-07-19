export const THUMBNAIL_SIZE_PX = 320;

/** Algorithm label stored in media.content_hash_algo. "sampled-sha256-v1" =
 * sha256 over size + first/last SAMPLE_CHUNK_BYTES (see hash.ts). Versioned so
 * a future change to the sampling scheme is distinguishable from old rows. */
export const HASH_ALGO = "sampled-sha256-v1";

/** Bytes read from the head and from the tail of each file for the sampled
 * fingerprint. 64KB each → ~128KB read per large file regardless of size. */
export const SAMPLE_CHUNK_BYTES = 64 * 1024;

export const EXIFTOOL_BATCH_SIZE = 300;

/** Concurrency for bulk fingerprinting. Higher than for full hashing since
 * each file now reads only ~128KB — the work is latency-bound on the network
 * share, so more in-flight requests helps. Tunable via env. */
export const HASH_CONCURRENCY = Number(process.env.PHOTO_MANAGER_HASH_CONCURRENCY ?? 32);

export const THUMBNAIL_CONCURRENCY = 4;
