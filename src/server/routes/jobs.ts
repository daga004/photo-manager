import { Database } from "bun:sqlite";
import { getImportJob, listImportJobEvents, listImportJobs } from "../db.ts";
import { pauseJob, resumeJob } from "../services/jobRunner.ts";
import { snapshot } from "../services/jobProgress.ts";

export function makeJobDetailHandler(db: Database) {
  return (req: Bun.BunRequest<"/api/jobs/:jobId">): Response => {
    const jobId = Number(req.params.jobId);
    const job = getImportJob(db, jobId);
    if (!job) return Response.json({ error: "not found" }, { status: 404 });
    // Merge in live, in-flight transfer progress from the in-memory store (not a
    // DB column) — present only while a job is actively copying, null otherwise.
    // The list handler intentionally stays lean and does NOT attach this.
    return Response.json({ ...job, progress: snapshot(jobId) });
  };
}

export function makeJobEventsHandler(db: Database) {
  return (req: Bun.BunRequest<"/api/jobs/:jobId/events">): Response => {
    const url = new URL(req.url);
    const since = Number(url.searchParams.get("since") ?? "0");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 1000);
    const events = listImportJobEvents(db, Number(req.params.jobId), since, limit);
    return Response.json(events);
  };
}

export function makeJobListHandler(db: Database) {
  return (req: Request): Response => {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
    return Response.json(listImportJobs(db, limit));
  };
}

export function makeJobResumeHandler(db: Database) {
  return (req: Bun.BunRequest<"/api/jobs/:jobId/resume">): Response => {
    const result = resumeJob(db, Number(req.params.jobId));
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
    return Response.json({ resumed: true });
  };
}

export function makeJobPauseHandler(db: Database) {
  return (req: Bun.BunRequest<"/api/jobs/:jobId/pause">): Response => {
    const result = pauseJob(db, Number(req.params.jobId));
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
    return Response.json({ pausing: true });
  };
}
