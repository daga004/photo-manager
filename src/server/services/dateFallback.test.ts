import { describe, expect, test } from "bun:test";
import { resolveCaptureDate } from "./dateFallback.ts";

describe("resolveCaptureDate", () => {
  test("uses DateTimeOriginal when present", () => {
    const result = resolveCaptureDate({
      dateTimeOriginal: "2024:07:15 14:23:52",
      createDate: "2024:07:16 00:00:00",
      fileMtimeMs: Date.now(),
    });
    expect(result.captureDate).toBe("2024-07-15");
    expect(result.captureDatetime).toBe("2024-07-15T14:23:52");
    expect(result.dateSource).toBe("exif_datetime_original");
  });

  test("falls back to CreateDate when DateTimeOriginal is absent", () => {
    const result = resolveCaptureDate({
      dateTimeOriginal: null,
      createDate: "2024:01:05 09:00:00",
      fileMtimeMs: Date.now(),
    });
    expect(result.captureDate).toBe("2024-01-05");
    expect(result.dateSource).toBe("exif_create_date");
  });

  test("falls back to file mtime when neither EXIF date is present", () => {
    const mtimeMs = new Date(2023, 5, 1, 10, 0, 0).getTime(); // June 1, 2023 local
    const result = resolveCaptureDate({ fileMtimeMs: mtimeMs });
    expect(result.captureDate).toBe("2023-06-01");
    expect(result.captureDatetime).toBeNull();
    expect(result.dateSource).toBe("file_mtime");
  });

  test("falls through a malformed DateTimeOriginal to CreateDate", () => {
    const result = resolveCaptureDate({
      dateTimeOriginal: "not-a-date",
      createDate: "2022:12:25 08:30:00",
      fileMtimeMs: Date.now(),
    });
    expect(result.captureDate).toBe("2022-12-25");
    expect(result.dateSource).toBe("exif_create_date");
  });

  test("treats exiftool's zero-date sentinel as absent", () => {
    const mtimeMs = new Date(2021, 0, 10).getTime();
    const result = resolveCaptureDate({
      dateTimeOriginal: "0000:00:00 00:00:00",
      createDate: undefined,
      fileMtimeMs: mtimeMs,
    });
    expect(result.dateSource).toBe("file_mtime");
    expect(result.captureDate).toBe("2021-01-10");
  });

  test("zero-pads month/day/time components", () => {
    const result = resolveCaptureDate({
      dateTimeOriginal: "2024:03:04 05:06:07",
      fileMtimeMs: Date.now(),
    });
    expect(result.captureDate).toBe("2024-03-04");
    expect(result.captureDatetime).toBe("2024-03-04T05:06:07");
  });
});
