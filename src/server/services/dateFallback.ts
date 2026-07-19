import type { DateSource } from "../../shared/types.ts";

export interface DateFallbackInput {
  dateTimeOriginal?: string | null;
  createDate?: string | null;
  /** File modification time in epoch milliseconds — last-resort fallback. */
  fileMtimeMs: number;
}

export interface DateFallbackResult {
  captureDate: string; // YYYY-MM-DD
  captureDatetime: string | null; // YYYY-MM-DDTHH:MM:SS, local, or null when only mtime is available
  dateSource: DateSource;
}

/**
 * exiftool emits EXIF/QuickTime dates as "YYYY:MM:DD HH:MM:SS" (colon-delimited
 * date), sometimes with a trailing sub-second or timezone offset we ignore —
 * we treat the value as the camera/device's local wall-clock time, matching
 * how EXIF dates are actually recorded (no reliable timezone info attached).
 * Also guards against exiftool's "0000:00:00 00:00:00" sentinel for absent dates.
 */
function parseExifDateTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m as unknown as [string, string, string, string, string, string, string];
  if (y === "0000" || mo === "00" || d === "00") return null;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function toIsoDateTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${toIsoDate(d)}T${h}:${mi}:${s}`;
}

export function resolveCaptureDate(input: DateFallbackInput): DateFallbackResult {
  const dto = parseExifDateTime(input.dateTimeOriginal);
  if (dto) {
    return { captureDate: toIsoDate(dto), captureDatetime: toIsoDateTime(dto), dateSource: "exif_datetime_original" };
  }

  const cd = parseExifDateTime(input.createDate);
  if (cd) {
    return { captureDate: toIsoDate(cd), captureDatetime: toIsoDateTime(cd), dateSource: "exif_create_date" };
  }

  const mtime = new Date(input.fileMtimeMs);
  return { captureDate: toIsoDate(mtime), captureDatetime: null, dateSource: "file_mtime" };
}
