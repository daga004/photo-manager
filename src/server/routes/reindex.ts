import { Database } from "bun:sqlite";
import { startReindexJob } from "../services/jobRunner.ts";

export function makeReindexHandler(db: Database) {
  return (_req: Request): Response => {
    const result = startReindexJob(db);
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
    return Response.json({ jobId: result.jobId }, { status: 202 });
  };
}
