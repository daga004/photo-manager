export const PHOTO_EXTENSIONS = [
  "jpg", "jpeg", "png", "heic", "heif", "gif", "tif", "tiff", "bmp", "webp", "arw",
] as const;

export const VIDEO_EXTENSIONS = [
  "mp4", "mov", "avi", "mkv", "mts", "webm",
] as const;

export const COMPANION_EXTENSIONS = ["aae"] as const;

export type MediaType = "photo" | "video";
export type Classification = MediaType | "companion" | null;

export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx === -1 || idx === filename.length - 1) return "";
  return filename.slice(idx + 1).toLowerCase();
}

export function classifyExtension(filename: string): Classification {
  const ext = getExtension(filename);
  if ((PHOTO_EXTENSIONS as readonly string[]).includes(ext)) return "photo";
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  if ((COMPANION_EXTENSIONS as readonly string[]).includes(ext)) return "companion";
  return null;
}

/**
 * True for files that should never be scanned/imported/indexed: macOS
 * AppleDouble sidecar files (created on SMB/AFP-mounted volumes) and
 * Finder/OS metadata files.
 */
export function shouldSkipFile(filename: string): boolean {
  return filename.startsWith("._") || filename === ".DS_Store" || filename.startsWith(".");
}

/**
 * Given a photo/video filename, returns the base name (no extension) used to
 * match a same-named `.AAE` companion file, e.g. "IMG_1234.HEIC" -> "IMG_1234".
 * Case-insensitive by design (iOS filenames are consistently uppercase, but
 * don't assume it).
 */
export function baseNameNoExt(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? filename : filename.slice(0, idx);
}
