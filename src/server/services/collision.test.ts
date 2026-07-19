import { describe, expect, test } from "bun:test";
import { resolveCollision } from "./collision.ts";

describe("resolveCollision", () => {
  test("places the file as-is when the name is free", () => {
    const result = resolveCollision("IMG_0001.JPG", "hashA", []);
    expect(result).toEqual({ kind: "place", filename: "IMG_0001.JPG" });
  });

  test("recognizes a same-hash collision as a true duplicate", () => {
    const result = resolveCollision("IMG_0001.JPG", "hashA", [{ name: "IMG_0001.JPG", hash: "hashA" }]);
    expect(result).toEqual({ kind: "duplicate", matchedName: "IMG_0001.JPG" });
  });

  test("disambiguates a different-hash collision with a __dup2 suffix", () => {
    const result = resolveCollision("IMG_0001.JPG", "hashB", [{ name: "IMG_0001.JPG", hash: "hashA" }]);
    expect(result).toEqual({ kind: "place", filename: "IMG_0001__dup2.JPG" });
  });

  test("iterates past an already-taken __dup2 to __dup3", () => {
    const result = resolveCollision("IMG_0001.JPG", "hashC", [
      { name: "IMG_0001.JPG", hash: "hashA" },
      { name: "IMG_0001__dup2.JPG", hash: "hashB" },
    ]);
    expect(result).toEqual({ kind: "place", filename: "IMG_0001__dup3.JPG" });
  });

  test("recognizes a same-hash match at an existing __dup2 slot as a duplicate", () => {
    const result = resolveCollision("IMG_0001.JPG", "hashB", [
      { name: "IMG_0001.JPG", hash: "hashA" },
      { name: "IMG_0001__dup2.JPG", hash: "hashB" },
    ]);
    expect(result).toEqual({ kind: "duplicate", matchedName: "IMG_0001__dup2.JPG" });
  });

  test("preserves the extension when disambiguating", () => {
    const result = resolveCollision("IMG_0002.HEIC", "hashB", [{ name: "IMG_0002.HEIC", hash: "hashA" }]);
    expect(result).toEqual({ kind: "place", filename: "IMG_0002__dup2.HEIC" });
  });
});
