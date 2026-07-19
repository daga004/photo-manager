import { describe, expect, test } from "bun:test";
import { parseAfcLsDate } from "./afc.ts";

describe("parseAfcLsDate", () => {
  test("parses a real afcclient ls -l date", () => {
    const ms = parseAfcLsDate("28", "Sep", "2025", "18:40:02");
    expect(ms).not.toBeNull();
    const d = new Date(ms as number);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(8); // September, zero-indexed
    expect(d.getDate()).toBe(28);
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(40);
    expect(d.getSeconds()).toBe(2);
  });

  test("handles all twelve month abbreviations", () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    months.forEach((month, index) => {
      const ms = parseAfcLsDate("01", month, "2024", "00:00:00");
      expect(ms).not.toBeNull();
      expect(new Date(ms as number).getMonth()).toBe(index);
    });
  });

  test("returns null for an unrecognized month abbreviation", () => {
    expect(parseAfcLsDate("01", "Xyz", "2024", "00:00:00")).toBeNull();
  });

  test("returns null for a malformed time", () => {
    expect(parseAfcLsDate("01", "Jan", "2024", "not-a-time")).toBeNull();
  });
});
