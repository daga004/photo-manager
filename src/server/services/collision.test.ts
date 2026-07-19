import { describe, expect, test } from "bun:test";
import { allocateFilename } from "./collision.ts";

describe("allocateFilename", () => {
  test("returns the name unchanged when it is free", () => {
    expect(allocateFilename("IMG_0001.JPG", [])).toBe("IMG_0001.JPG");
    expect(allocateFilename("IMG_0001.JPG", ["OTHER.JPG"])).toBe("IMG_0001.JPG");
  });

  test("appends __dup2 on a name clash", () => {
    expect(allocateFilename("IMG_0001.JPG", ["IMG_0001.JPG"])).toBe("IMG_0001__dup2.JPG");
  });

  test("iterates past an already-taken __dup2 to __dup3", () => {
    expect(allocateFilename("IMG_0001.JPG", ["IMG_0001.JPG", "IMG_0001__dup2.JPG"])).toBe("IMG_0001__dup3.JPG");
  });

  test("preserves the extension when disambiguating", () => {
    expect(allocateFilename("IMG_0002.HEIC", ["IMG_0002.HEIC"])).toBe("IMG_0002__dup2.HEIC");
  });

  test("handles a filename with no extension", () => {
    expect(allocateFilename("README", ["README"])).toBe("README__dup2");
  });
});
