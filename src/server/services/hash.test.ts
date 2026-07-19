import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_CHUNK_BYTES } from "../../shared/constants.ts";
import { sampledFingerprint, verifyIdentical } from "./hash.ts";

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
    const size = SAMPLE_CHUNK_BYTES; // one chunk, under the 2-chunk threshold
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
  test("true for byte-identical files, across chunk boundaries", async () => {
    // >64KB so streaming yields multiple chunks that won't align identically.
    const a = await writeFile("id_a.bin", filled(300_000, 1));
    const b = await writeFile("id_b.bin", filled(300_000, 1));
    expect(await verifyIdentical(a, b)).toBe(true);
  });

  test("false (via the size guard) when sizes differ", async () => {
    const a = await writeFile("sz_a.bin", filled(1000, 1));
    const b = await writeFile("sz_b.bin", filled(1001, 1));
    expect(await verifyIdentical(a, b)).toBe(false);
  });

  test("false for same-size files differing at the very first byte", async () => {
    const base = filled(200_000, 1);
    const mutated = filled(200_000, 1);
    mutated[0] = 2;
    const a = await writeFile("first_a.bin", base);
    const b = await writeFile("first_b.bin", mutated);
    expect(await verifyIdentical(a, b)).toBe(false);
  });

  test("false for same-size files differing at the very last byte", async () => {
    const base = filled(200_000, 1);
    const mutated = filled(200_000, 1);
    mutated[mutated.length - 1] = 2;
    const a = await writeFile("last_a.bin", base);
    const b = await writeFile("last_b.bin", mutated);
    expect(await verifyIdentical(a, b)).toBe(false);
  });

  test("true for two empty files", async () => {
    const a = await writeFile("empty_a.bin", new Uint8Array(0));
    const b = await writeFile("empty_b.bin", new Uint8Array(0));
    expect(await verifyIdentical(a, b)).toBe(true);
  });
});
