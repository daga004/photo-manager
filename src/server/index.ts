import indexHtml from "../client/index.html";
import { getDb, reconcileStuckJobs } from "./db.ts";
import { config, getLibraryRoot } from "./config.ts";
import {
  loadLibraryRootFromSettings,
  makeSettingsGetHandler,
  makeSettingsUpdateHandler,
} from "./routes/settings.ts";
import { makeDaysListHandler, makeDayDetailHandler, makeDayOpenHandler, makeUndatedHandler, makeNonCameraHandler } from "./routes/days.ts";
import {
  makeMediaDeleteHandler,
  makeMediaDetailHandler,
  makeMediaFullHandler,
  makeMediaOpenHandler,
  makeMediaRestoreHandler,
} from "./routes/media.ts";
import { makePreviewHandler, makeThumbnailHandler } from "./routes/thumbnails.ts";
import { makeImportHandler, makeDeviceImportHandler } from "./routes/import.ts";
import { makeReindexHandler } from "./routes/reindex.ts";
import {
  makeActiveJobHandler,
  makeJobDetailHandler,
  makeJobEventsHandler,
  makeJobListHandler,
  makeJobPauseHandler,
  makeJobResumeHandler,
} from "./routes/jobs.ts";
import { makeDuplicatesListHandler, makeDuplicatesResolveHandler } from "./routes/duplicates.ts";
import { makeDevicesListHandler } from "./routes/devices.ts";
import { makePickFolderHandler } from "./routes/pickFolder.ts";
import { makeOpenPathHandler } from "./routes/openPath.ts";
import { startThumbnailPregen } from "./services/thumbnailPregen.ts";

const db = getDb();
// Only the real, long-lived server process should ever reconcile stuck jobs —
// see db.ts's getDb() doc comment for why this must not live inside getDb() itself.
reconcileStuckJobs(db);
// Apply the persisted library root (if the user configured one) before serving.
loadLibraryRootFromSettings(db);

const server = Bun.serve({
  port: config.port,
  routes: {
    "/": indexHtml,

    "/api/health": () =>
      Response.json({ status: "ok", dbPath: config.dbPath, libraryRoot: getLibraryRoot() }),

    "/api/settings": makeSettingsGetHandler(db),
    "/api/settings/update": { POST: makeSettingsUpdateHandler(db) },

    "/api/days": makeDaysListHandler(db),
    "/api/days/:date": makeDayDetailHandler(db),
    "/api/days/:date/open": { POST: makeDayOpenHandler(db) },
    "/api/undated": makeUndatedHandler(db),
    "/api/non-camera": makeNonCameraHandler(db),

    "/api/media/:id": makeMediaDetailHandler(db),
    "/api/media/:id/full": makeMediaFullHandler(db),
    "/api/media/:id/thumbnail": makeThumbnailHandler(db),
    "/api/media/:id/preview": makePreviewHandler(db),
    "/api/media/:id/open": { POST: makeMediaOpenHandler(db) },
    "/api/media/:id/delete": { POST: makeMediaDeleteHandler(db) },
    "/api/media/:id/restore": { POST: makeMediaRestoreHandler(db) },

    "/api/devices": makeDevicesListHandler(),

    "/api/pick-folder": { POST: makePickFolderHandler() },
    "/api/open-path": { POST: makeOpenPathHandler() },

    "/api/import": { POST: makeImportHandler(db) },
    "/api/import/device": { POST: makeDeviceImportHandler(db) },
    "/api/reindex": { POST: makeReindexHandler(db) },

    "/api/active-job": makeActiveJobHandler(db),
    "/api/jobs": makeJobListHandler(db),
    "/api/jobs/:jobId": makeJobDetailHandler(db),
    "/api/jobs/:jobId/events": makeJobEventsHandler(db),
    "/api/jobs/:jobId/resume": { POST: makeJobResumeHandler(db) },
    "/api/jobs/:jobId/pause": { POST: makeJobPauseHandler(db) },

    "/api/duplicates": makeDuplicatesListHandler(db),
    "/api/duplicates/resolve": { POST: makeDuplicatesResolveHandler(db) },
  },
  fetch(req) {
    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log(`photo-manager listening on http://localhost:${server.port}`);
console.log(`  library root: ${getLibraryRoot()}`);
console.log(`  data dir:     ${config.dataDir}`);

// Warm the thumbnail cache in the background (pauses itself during imports).
startThumbnailPregen(db);
