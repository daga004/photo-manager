import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  baseNameNoExt,
  classifyExtension,
  getExtension,
  shouldSkipFile,
  type MediaType,
} from "../../shared/extensions.ts";

export interface ScannedFile {
  absolutePath: string;
  filename: string;
  extension: string;
  mediaType: MediaType;
  /** Absolute path to a same-named .AAE sidecar in the same directory, if any. */
  companionAaePath: string | null;
}

/**
 * Recursively walks `rootPath`, returning every photo/video file found
 * (skipping AppleDouble/.DS_Store/dotfiles), each paired with its .AAE
 * companion sidecar when one exists alongside it.
 */
export async function scanDirectory(rootPath: string): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];
  await walk(rootPath, results);
  return results;
}

async function walk(dir: string, results: ScannedFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  const companionsByBase = new Map<string, string>();
  for (const entry of entries) {
    if (entry.isFile() && !shouldSkipFile(entry.name) && classifyExtension(entry.name) === "companion") {
      companionsByBase.set(baseNameNoExt(entry.name).toLowerCase(), join(dir, entry.name));
    }
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(full, results);
      continue;
    }
    if (!entry.isFile() || shouldSkipFile(entry.name)) continue;

    const classification = classifyExtension(entry.name);
    if (classification !== "photo" && classification !== "video") continue;

    results.push({
      absolutePath: full,
      filename: entry.name,
      extension: getExtension(entry.name),
      mediaType: classification,
      companionAaePath: companionsByBase.get(baseNameNoExt(entry.name).toLowerCase()) ?? null,
    });
  }
}
