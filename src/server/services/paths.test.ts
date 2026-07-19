import { describe, expect, test } from "bun:test";
import { computeDestinationRelativePath } from "./paths.ts";

describe("computeDestinationRelativePath", () => {
  test("places photos under photos/YYYY/MM/DD", () => {
    expect(computeDestinationRelativePath("photo", "2024-07-15", "IMG_0001.HEIC")).toBe(
      "photos/2024/07/15/IMG_0001.HEIC",
    );
  });

  test("places videos under videos/YYYY/MM/DD", () => {
    expect(computeDestinationRelativePath("video", "2024-07-15", "IMG_0002.MOV")).toBe(
      "videos/2024/07/15/IMG_0002.MOV",
    );
  });

  test("preserves zero-padded single-digit months and days", () => {
    expect(computeDestinationRelativePath("photo", "2024-01-05", "IMG_0003.JPG")).toBe(
      "photos/2024/01/05/IMG_0003.JPG",
    );
  });

  test("handles a year boundary correctly", () => {
    expect(computeDestinationRelativePath("photo", "2023-12-31", "IMG_0004.JPG")).toBe(
      "photos/2023/12/31/IMG_0004.JPG",
    );
    expect(computeDestinationRelativePath("photo", "2024-01-01", "IMG_0005.JPG")).toBe(
      "photos/2024/01/01/IMG_0005.JPG",
    );
  });

  test("throws on a malformed captureDate", () => {
    expect(() => computeDestinationRelativePath("photo", "not-a-date", "IMG_0006.JPG")).toThrow();
  });
});
