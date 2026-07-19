import { Database } from "bun:sqlite";
import { startReindexJob } from "../services/jobRunner.ts";

export function makeReindexHandler(db: Database) {
  return (_req: Request): Response => {
    const jobId = startReindexJob(db);
    return Response.json({ jobId }, { status: 202 });
  };
}
