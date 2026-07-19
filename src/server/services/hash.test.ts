import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_CHUNK_BYTES } from "../../shared/constants.ts";
import { fullHash, sampledFingerprint, verifyIdentical } from "./hash.ts";

const dir = mkdtempSync(join(tmpdir(), "pm-hash-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function writeFile(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await Bun.write(path, bytes);
  return path;
}

function filled(size: number, value: number): Uint8Array {
  return new Uint8Array(size).fill(value);
}

describe("sampledFingerprint", () => {
  test("identical files produce identical fingerprints", async () => {
    const a = await writeFile("a.bin", filled(500_000, 7));
    const b = await writeFile("b.bin", filled(500_000, 7));
    expect(await sampledFingerprint(a)).toBe(await sampledFingerprint(b));
  });

  test("files of different size never collide (size is part of the fingerprint)", async () => {
    const a = await writeFile("size1.bin", filled(500_000, 7));
    const b = await writeFile("size2.bin", filled(500_001, 7));
    expect(await sampledFingerprint(a)).not.toBe(await sampledFingerprint(b));
  });

  test("small files (<= 2 chunks) are effectively fully hashed", async () => {
    // Two small files identical except one middle byte -> different fingerprint,
    // because small files are hashed in full.
    const size = SAMPLE_CHUNK_BYTES; // one chunk, well under the 2-chunk threshold
    const base = filled(size, 3);
    const mutated = filled(size, 3);
    mutated[Math.floor(size / 2)] = 99;
    const a = await writeFile("small_a.bin", base);
    const b = await writeFile("small_b.bin", mutated);
    expect(await sampledFingerprint(a)).not.toBe(await sampledFingerprint(b));
  });

  test("large files sharing size+head+tail but differing in the MIDDLE collide on fingerprint — this is why verify exists", async () => {
    const size = 4 * SAMPLE_CHUNK_BYTES; // large enough to be sampled, not fully hashed
    const base = filled(size, 5);
    const mutated = filled(size, 5);
    mutated[Math.floor(size / 2)] = 42; // change only a middle byte, outside sampled ranges
    const a = await writeFile("big_a.bin", base);
    const b = await writeFile("big_b.bin", mutated);

    // Fingerprints collide (the escalation trap)...
    expect(await sampledFingerprint(a)).toBe(await sampledFingerprint(b));
    // ...but a full verify correctly rejects them as non-identical.
    expect(await verifyIdentical(a, b)).toBe(false);
  });
});

describe("verifyIdentical", () => {
  test("true for byte-identical files", async () => {
    const a = await writeFile("id_a.bin", filled(300_000, 1));
    const b = await writeFile("id_b.bin", filled(300_000, 1));
    expect(await verifyIdentical(a, b)).toBe(true);
  });

  test("fullHash differs for differing content", async () => {
    const a = await writeFile("fh_a.bin", filled(1000, 1));
    const b = await writeFile("fh_b.bin", filled(1000, 2));
    expect(await fullHash(a)).not.toBe(await fullHash(b));
  });
});
