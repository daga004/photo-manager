import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { startDeviceImportJob, startImportJob } from "../services/jobRunner.ts";
import { getDeviceInfo } from "../services/afc.ts";

export function makeImportHandler(db: Database) {
  return async (req: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const sourcePath = (body as { sourcePath?: unknown }).sourcePath;
    if (typeof sourcePath !== "string" || sourcePath.trim() === "") {
      return Response.json({ error: "sourcePath is required" }, { status: 400 });
    }
    if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
      return Response.json({ error: `sourcePath does not exist or is not a directory: ${sourcePath}` }, { status: 400 });
    }

    const jobId = startImportJob(db, sourcePath);
    return Response.json({ jobId }, { status: 202 });
  };
}

export function makeDeviceImportHandler(db: Database) {
  return async (req: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const { udid, deleteAfterVerify } = body as { udid?: unknown; deleteAfterVerify?: unknown };
    if (typeof udid !== "string" || udid.trim() === "") {
      return Response.json({ error: "udid is required" }, { status: 400 });
    }

    let deviceName = udid;
    try {
      const info = await getDeviceInfo(udid);
      deviceName = info.name || udid;
    } catch {
      // Non-fatal: proceed with the UDID as the display name if info lookup fails.
    }

    const jobId = startDeviceImportJob(db, udid, deviceName, deleteAfterVerify === true);
    return Response.json({ jobId }, { status: 202 });
  };
}
