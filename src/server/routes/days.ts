import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { countNonCamera, countUndated, getDayAggregates, getDayItems, getNonCameraItems, getUndatedItems } from "../db.ts";
import { nativeOpen } from "./openPath.ts";
import type { DayItem, MediaRecord } from "../../shared/types.ts";

function toDayItems(media: MediaRecord[]): DayItem[] {
  return media.map((m) => ({
    id: m.id,
    filename: m.filename,
    mediaType: m.mediaType,
    extension: m.extension,
    sizeBytes: m.sizeBytes,
    width: m.width,
    height: m.height,
    durationSeconds: m.durationSeconds,
    thumbnailUrl: `/api/media/${m.id}/thumbnail`,
  }));
}

export function makeDaysListHandler(db: Database) {
  return (req: Request): Response => {
    const url = new URL(req.url);
    const sortByParam = url.searchParams.get("sortBy");
    const sortBy: "count" | "size" = sortByParam === "size" ? "size" : "count";
    const order: "asc" | "desc" = url.searchParams.get("order") === "asc" ? "asc" : "desc";
    const typeParam = url.searchParams.get("type");
    const type: "photo" | "video" | "all" =
      typeParam === "photo" || typeParam === "video" ? typeParam : "all";

    const days = getDayAggregates(db, { sortBy, order, type });
    return Response.json(days);
  };
}

export function makeDayDetailHandler(db: Database) {
  return (req: Bun.BunRequest<"/api/days/:date">): Response => {
    const date = req.params.date;
    return Response.json({ date, items: toDayItems(getDayItems(db, date)) });
  };
}

/** Opens the on-disk folder(s) for a day in the host's file manager, so the user
 * can probe/organize/delete with native tools. A day's camera files can live in
 * up to two trees (photos/YYYY/MM/DD and videos/YYYY/MM/DD); we open each distinct
 * directory. Filters mirror the day-detail view (dated camera media only). */
export function makeDayOpenHandler(db: Database) {
  return async (req: Bun.BunRequest<"/api/days/:date/open">): Promise<Response> => {
    const date = req.params.date;
    const rows = db
      .query(
        "SELECT DISTINCT path FROM media WHERE capture_date = ? AND status = 'active' AND origin = 'camera' AND is_undated = 0",
      )
      .all(date) as Array<{ path: string }>;
    const dirs = [...new Set(rows.map((r) => dirname(r.path)))];
    if (dirs.length === 0) return Response.json({ error: "no files on disk for this day" }, { status: 404 });
    try {
      for (const dir of dirs) await nativeOpen(dir);
      return Response.json({ opened: dirs.length });
    } catch (err) {
      return Response.json(
        { error: `could not open folder(s): ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 },
      );
    }
  };
}

export function makeUndatedHandler(db: Database) {
  return (_req: Request): Response => {
    return Response.json({ count: countUndated(db), items: toDayItems(getUndatedItems(db)) });
  };
}

export function makeNonCameraHandler(db: Database) {
  return (_req: Request): Response => {
    return Response.json({ count: countNonCamera(db), items: toDayItems(getNonCameraItems(db)) });
  };
}
