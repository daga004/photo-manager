import { Database } from "bun:sqlite";
import { countNonCamera, countUndated, getDayAggregates, getDayItems, getNonCameraItems, getUndatedItems } from "../db.ts";
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
