import { describe, expect, test } from "bun:test";
import { baseNameNoExt, classifyExtension, shouldSkipFile } from "./extensions.ts";

describe("classifyExtension", () => {
  test("classifies all photo extensions, case-insensitively", () => {
    for (const ext of ["jpg", "JPG", "jpeg", "png", "heic", "HEIC", "heif", "gif", "tif", "tiff", "bmp", "webp", "arw"]) {
      expect(classifyExtension(`file.${ext}`)).toBe("photo");
    }
  });

  test("classifies all video extensions, case-insensitively", () => {
    for (const ext of ["mp4", "MP4", "mov", "avi", "mkv", "mts", "webm"]) {
      expect(classifyExtension(`file.${ext}`)).toBe("video");
    }
  });

  test("classifies .aae as a companion file", () => {
    expect(classifyExtension("IMG_1234.AAE")).toBe("companion");
    expect(classifyExtension("IMG_1234.aae")).toBe("companion");
  });

  test("returns null for unknown extensions", () => {
    expect(classifyExtension("notes.txt")).toBeNull();
    expect(classifyExtension("archive.zip")).toBeNull();
  });

  test("returns null for a filename with no extension", () => {
    expect(classifyExtension("README")).toBeNull();
  });
});

describe("shouldSkipFile", () => {
  test("skips AppleDouble sidecar files", () => {
    expect(shouldSkipFile("._IMG_1234.HEIC")).toBe(true);
  });

  test("skips .DS_Store", () => {
    expect(shouldSkipFile(".DS_Store")).toBe(true);
  });

  test("skips other dotfiles", () => {
    expect(shouldSkipFile(".hidden")).toBe(true);
  });

  test("does not skip normal media filenames", () => {
    expect(shouldSkipFile("IMG_1234.JPG")).toBe(false);
    expect(shouldSkipFile("IMG_1234.AAE")).toBe(false);
  });
});

describe("baseNameNoExt", () => {
  test("strips the extension", () => {
    expect(baseNameNoExt("IMG_1234.HEIC")).toBe("IMG_1234");
  });

  test("matches a photo and its .AAE companion to the same base name", () => {
    expect(baseNameNoExt("IMG_1234.HEIC")).toBe(baseNameNoExt("IMG_1234.AAE"));
  });

  test("returns the whole name when there is no extension", () => {
    expect(baseNameNoExt("README")).toBe("README");
  });
});
