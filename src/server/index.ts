import indexHtml from "../client/index.html";
import { getDb } from "./db.ts";
import { config } from "./config.ts";
import { makeDaysListHandler, makeDayDetailHandler } from "./routes/days.ts";
import { makeMediaDetailHandler, makeMediaFullHandler, makeMediaRestoreHandler } from "./routes/media.ts";
import { makeThumbnailHandler } from "./routes/thumbnails.ts";
import { makeImportHandler, makeDeviceImportHandler } from "./routes/import.ts";
import { makeReindexHandler } from "./routes/reindex.ts";
import { makeJobDetailHandler, makeJobEventsHandler, makeJobListHandler, makeJobResumeHandler } from "./routes/jobs.ts";
import { makeDuplicatesListHandler, makeDuplicatesResolveHandler } from "./routes/duplicates.ts";
import { makeDevicesListHandler } from "./routes/devices.ts";

const db = getDb();

const server = Bun.serve({
  port: config.port,
  routes: {
    "/": indexHtml,

    "/api/health": () =>
      Response.json({ status: "ok", dbPath: config.dbPath, libraryRoot: config.libraryRoot }),

    "/api/days": makeDaysListHandler(db),
    "/api/days/:date": makeDayDetailHandler(db),

    "/api/media/:id": makeMediaDetailHandler(db),
    "/api/media/:id/full": makeMediaFullHandler(db),
    "/api/media/:id/thumbnail": makeThumbnailHandler(db),
    "/api/media/:id/restore": { POST: makeMediaRestoreHandler(db) },

    "/api/devices": makeDevicesListHandler(),

    "/api/import": { POST: makeImportHandler(db) },
    "/api/import/device": { POST: makeDeviceImportHandler(db) },
    "/api/reindex": { POST: makeReindexHandler(db) },

    "/api/jobs": makeJobListHandler(db),
    "/api/jobs/:jobId": makeJobDetailHandler(db),
    "/api/jobs/:jobId/events": makeJobEventsHandler(db),
    "/api/jobs/:jobId/resume": { POST: makeJobResumeHandler(db) },

    "/api/duplicates": makeDuplicatesListHandler(db),
    "/api/duplicates/resolve": { POST: makeDuplicatesResolveHandler(db) },
  },
  fetch(req) {
    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log(`photo-manager listening on http://localhost:${server.port}`);
console.log(`  library root: ${config.libraryRoot}`);
console.log(`  data dir:     ${config.dataDir}`);
