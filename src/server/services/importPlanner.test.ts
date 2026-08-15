import { describe, expect, test } from "bun:test";
import { planAllocations, type AllocInput, type AllocOp } from "./importPlanner.ts";

const DIR = "photos/2026/08/15";

function newFile(ref: number, filename: string, destRelativeDir = DIR): AllocInput {
  return { ref, filename, destRelativeDir, duplicateOf: null };
}

describe("planAllocations", () => {
  test("single new file into an empty dir is imported unchanged", () => {
    const ops = planAllocations([newFile(0, "IMG.jpg")], new Map());
    expect(ops).toEqual([
      { action: "import", ref: 0, destRelativeDir: DIR, destFilename: "IMG.jpg" },
    ]);
  });

  test("two new same-name files in the same dir: first keeps name, second gets __dup2", () => {
    const inputs = [newFile(0, "IMG.jpg"), newFile(1, "IMG.jpg")];
    const ops = planAllocations(inputs, new Map());
    expect(ops).toEqual([
      { action: "import", ref: 0, destRelativeDir: DIR, destFilename: "IMG.jpg" },
      { action: "import", ref: 1, destRelativeDir: DIR, destFilename: "IMG__dup2.jpg" },
    ]);
  });

  test("three same-name new files increment through __dup2 then __dup3", () => {
    const inputs = [newFile(0, "IMG.jpg"), newFile(1, "IMG.jpg"), newFile(2, "IMG.jpg")];
    const ops = planAllocations(inputs, new Map());
    expect(ops).toEqual([
      { action: "import", ref: 0, destRelativeDir: DIR, destFilename: "IMG.jpg" },
      { action: "import", ref: 1, destRelativeDir: DIR, destFilename: "IMG__dup2.jpg" },
      { action: "import", ref: 2, destRelativeDir: DIR, destFilename: "IMG__dup3.jpg" },
    ]);
  });

  test("a pre-existing name in the library dir bumps a new same-name file to __dup2", () => {
    const existing = new Map<string, Iterable<string>>([[DIR, ["IMG.jpg"]]]);
    const ops = planAllocations([newFile(0, "IMG.jpg")], existing);
    expect(ops).toEqual([
      { action: "import", ref: 0, destRelativeDir: DIR, destFilename: "IMG__dup2.jpg" },
    ]);
  });

  test("library duplicate is quarantined and does NOT reserve the name", () => {
    const inputs: AllocInput[] = [
      { ref: 0, filename: "IMG.jpg", destRelativeDir: DIR, duplicateOf: { kind: "library", matchedName: "IMG.jpg" } },
      newFile(1, "IMG.jpg"),
    ];
    const ops = planAllocations(inputs, new Map());
    expect(ops).toEqual([
      { action: "quarantine_duplicate", ref: 0, matchedName: "IMG.jpg" },
      // The later different-content file still gets the base name (quarantine reserved nothing).
      { action: "import", ref: 1, destRelativeDir: DIR, destFilename: "IMG.jpg" },
    ]);
  });

  test("intra-batch duplicate is skipped carrying matchedRef and reserves no name", () => {
    const inputs: AllocInput[] = [
      newFile(0, "IMG.jpg"),
      { ref: 1, filename: "IMG.jpg", destRelativeDir: DIR, duplicateOf: { kind: "batch", matchedRef: 0 } },
      newFile(2, "IMG.jpg"),
    ];
    const ops = planAllocations(inputs, new Map());
    expect(ops).toEqual([
      { action: "import", ref: 0, destRelativeDir: DIR, destFilename: "IMG.jpg" },
      { action: "skip_intrabatch_duplicate", ref: 1, matchedRef: 0 },
      // ref 1 reserved nothing, so ref 2 is the second real IMG.jpg and gets __dup2.
      { action: "import", ref: 2, destRelativeDir: DIR, destFilename: "IMG__dup2.jpg" },
    ]);
  });

  test("same filename across different dirs each keeps the base name (per-dir reservation)", () => {
    const dirA = "photos/2026/08/15";
    const dirB = "photos/2026/08/16";
    const inputs = [newFile(0, "IMG.jpg", dirA), newFile(1, "IMG.jpg", dirB)];
    const ops = planAllocations(inputs, new Map());
    expect(ops).toEqual([
      { action: "import", ref: 0, destRelativeDir: dirA, destFilename: "IMG.jpg" },
      { action: "import", ref: 1, destRelativeDir: dirB, destFilename: "IMG.jpg" },
    ]);
  });

  test("preserves input order and maps each op to its ref when refs are shuffled", () => {
    const inputs: AllocInput[] = [
      newFile(7, "IMG.jpg"),
      { ref: 3, filename: "IMG.jpg", destRelativeDir: DIR, duplicateOf: { kind: "batch", matchedRef: 7 } },
      { ref: 42, filename: "OTHER.jpg", destRelativeDir: DIR, duplicateOf: { kind: "library", matchedName: "OTHER.jpg" } },
      newFile(5, "IMG.jpg"),
    ];
    const ops = planAllocations(inputs, new Map());
    expect(ops.map((op) => op.ref)).toEqual([7, 3, 42, 5]);
    expect(ops.map((op) => op.action)).toEqual([
      "import",
      "skip_intrabatch_duplicate",
      "quarantine_duplicate",
      "import",
    ]);
    expect(ops).toEqual([
      { action: "import", ref: 7, destRelativeDir: DIR, destFilename: "IMG.jpg" },
      { action: "skip_intrabatch_duplicate", ref: 3, matchedRef: 7 },
      { action: "quarantine_duplicate", ref: 42, matchedName: "OTHER.jpg" },
      { action: "import", ref: 5, destRelativeDir: DIR, destFilename: "IMG__dup2.jpg" },
    ]);
  });

  test("an empty input array yields no ops", () => {
    expect(planAllocations([], new Map())).toEqual([]);
  });
});
