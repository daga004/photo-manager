import { describe, expect, test } from "bun:test";
import { isAppManagedDirectory } from "./scanner.ts";

describe("isAppManagedDirectory", () => {
  test("recognizes a Photos library bundle", () => {
    expect(isAppManagedDirectory("Photos Library.photoslibrary")).toBe(true);
  });

  test("recognizes Photo Booth Library case-insensitively", () => {
    expect(isAppManagedDirectory("Photo Booth Library")).toBe(true);
    expect(isAppManagedDirectory("photo booth library")).toBe(true);
  });

  test("recognizes generic macOS app/bundle/framework directories", () => {
    expect(isAppManagedDirectory("Some Tool.app")).toBe(true);
    expect(isAppManagedDirectory("Something.bundle")).toBe(true);
    expect(isAppManagedDirectory("Something.framework")).toBe(true);
  });

  test("does not flag a plain folder of photos", () => {
    expect(isAppManagedDirectory("iPhone-Import")).toBe(false);
    expect(isAppManagedDirectory("2024")).toBe(false);
    expect(isAppManagedDirectory("Vacation Photos")).toBe(false);
  });
});
