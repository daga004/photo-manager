import { Database } from "bun:sqlite";
import { basename, join } from "node:path";
import {
  findActiveMediaByHashAll,
  findDuplicateHashGroups,
  insertDuplicateResolution,
  quarantineMedia,
} from "../db.ts";
import { config } from "../config.ts";
import { safeMoveFile } from "../services/fsmove.ts";
import type { DuplicateGroup } from "../../shared/types.ts";

export function makeDuplicatesListHandler(db: Database) {
  return (req: Request): Response => {
    const url = new URL(req.url);
    const includeResolved = url.searchParams.get("includeResolved") === "true";
    const groups = findDuplicateHashGroups(db, includeResolved);

    const result: DuplicateGroup[] = groups.map((g) => {
      const items = findActiveMediaByHashAll(db, g.contentHash);
      return {
        contentHash: g.contentHash,
        sizeBytes: g.sizeBytes,
        count: g.count,
        items: items.map((m) => ({
          id: m.id,
          path: m.path,
          filename: m.filename,
          captureDate: m.captureDate,
          importedAt: m.importedAt,
          thumbnailUrl: `/api/media/${m.id}/thumbnail`,
        })),
      };
    });

    return Response.json(result);
  };
}

export function makeDuplicatesResolveHandler(db: Database) {
  return async (req: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const { contentHash, keepMediaId, action } = body as {
      contentHash?: unknown;
      keepMediaId?: unknown;
      action?: unknown;
    };
    if (typeof contentHash !== "string" || typeof keepMediaId !== "number") {
      return Response.json({ error: "contentHash (string) and keepMediaId (number) are required" }, { status: 400 });
    }
    if (action !== "delete_extras" && action !== "ignore") {
      return Response.json({ error: "action must be 'delete_extras' or 'ignore'" }, { status: 400 });
    }

    const items = findActiveMediaByHashAll(db, contentHash);
    if (!items.some((m) => m.id === keepMediaId)) {
      return Response.json({ error: "keepMediaId is not an active member of this duplicate group" }, { status: 400 });
    }

    if (action === "ignore") {
      insertDuplicateResolution(db, { contentHash, keptMediaId: keepMediaId, action: "ignored" });
      return Response.json({ quarantinedCount: 0, keptMediaId: keepMediaId });
    }

    let quarantinedCount = 0;
    for (const item of items) {
      if (item.id === keepMediaId) continue;
      const dest = join(config.quarantineDuplicatesDir, `${item.id}_${basename(item.path)}`);
      await safeMoveFile(item.path, dest);
      quarantineMedia(db, item.id, dest, `duplicate, kept media #${keepMediaId}`);
      quarantinedCount++;
    }
    insertDuplicateResolution(db, { contentHash, keptMediaId: keepMediaId, action: "deleted_extras" });

    return Response.json({ quarantinedCount, keptMediaId: keepMediaId });
  };
}
