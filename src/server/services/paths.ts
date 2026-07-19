import type { MediaType } from "../../shared/extensions.ts";

/**
 * Computes the library-relative destination path for a media file, matching
 * the NAS's existing convention: photos|videos/YYYY/MM/DD/filename.
 * `captureDate` must be an ISO YYYY-MM-DD string (see dateFallback.ts).
 */
export function computeDestinationRelativePath(
  mediaType: MediaType,
  captureDate: string,
  filename: string,
): string {
  const match = captureDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid captureDate, expected YYYY-MM-DD: ${captureDate}`);
  }
  const [, year, month, day] = match;
  const bucket = mediaType === "photo" ? "photos" : "videos";
  return `${bucket}/${year}/${month}/${day}/${filename}`;
}
