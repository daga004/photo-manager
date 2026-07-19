import { EXIFTOOL_BATCH_SIZE } from "../../shared/constants.ts";

export interface ExifMetadata {
  dateTimeOriginal?: string;
  createDate?: string;
  imageWidth?: number;
  imageHeight?: number;
  duration?: number;
  /** Camera manufacturer from EXIF. Present on genuine captures (iPhone,
   * DSLR, any camera); stripped on WhatsApp/downloaded/screenshot images —
   * so its presence is the "camera capture vs junk" signal. */
  make?: string;
}

interface ExiftoolJsonEntry {
  SourceFile: string;
  DateTimeOriginal?: string;
  CreateDate?: string;
  ImageWidth?: number;
  ImageHeight?: number;
  Duration?: number;
  Make?: string;
}

/**
 * Extracts capture-date and dimension/duration metadata for many files at
 * once, batching paths through exiftool's `-@ -` stdin argfile mechanism
 * instead of spawning one process per file — the difference between ~100
 * process launches and ~34,000 at full-library scale.
 *
 * Deliberately uses `-fast` (not `-fast2`): `-fast2` skips enough of the file
 * that QuickTime video CreateDate/Duration/dimensions came back empty in
 * testing, while `-fast` returns identical results to no flag at all for
 * both photos and videos with no meaningful speed cost at this batch size.
 */
export async function batchExtractMetadata(paths: readonly string[]): Promise<Map<string, ExifMetadata>> {
  const results = new Map<string, ExifMetadata>();
  for (let i = 0; i < paths.length; i += EXIFTOOL_BATCH_SIZE) {
    const batch = paths.slice(i, i + EXIFTOOL_BATCH_SIZE);
    const batchResults = await runExiftoolBatch(batch);
    for (const [key, value] of batchResults) results.set(key, value);
  }
  return results;
}

async function runExiftoolBatch(paths: readonly string[]): Promise<Map<string, ExifMetadata>> {
  const proc = Bun.spawn(
    [
      "exiftool",
      "-j",
      "-fast",
      "-DateTimeOriginal",
      "-CreateDate",
      "-ImageWidth#",
      "-ImageHeight#",
      "-Duration#",
      "-Make",
      "-@",
      "-",
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );

  proc.stdin.write(paths.join("\n") + "\n");
  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  let parsed: ExiftoolJsonEntry[];
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `exiftool output could not be parsed as JSON (exit ${exitCode}): ${stderr.slice(0, 500) || stdout.slice(0, 500)}`,
    );
  }

  const map = new Map<string, ExifMetadata>();
  for (const entry of parsed) {
    map.set(entry.SourceFile, {
      dateTimeOriginal: entry.DateTimeOriginal,
      createDate: entry.CreateDate,
      imageWidth: entry.ImageWidth,
      imageHeight: entry.ImageHeight,
      duration: entry.Duration,
      make: entry.Make,
    });
  }
  return map;
}

/** Genuine camera capture vs junk (WhatsApp/download/screenshot), by whether
 * EXIF carries a camera Make. See ExifMetadata.make. */
export function originFromMeta(meta: ExifMetadata | undefined): "camera" | "other" {
  return meta?.make && meta.make.trim() !== "" ? "camera" : "other";
}
