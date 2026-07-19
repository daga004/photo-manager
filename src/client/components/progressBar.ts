import { getJob, resumeJob } from "../api.ts";
import type { ImportJobRecord } from "../../shared/types.ts";

export interface ProgressHandle {
  stop: () => void;
}

export function renderProgress(container: HTMLElement, job: ImportJobRecord): void {
  const pct = job.filesFound > 0 ? Math.round((job.filesProcessed / job.filesFound) * 100) : 0;
  container.innerHTML = `
    <div class="progress-status">Status: <strong>${job.status}</strong></div>
    <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    <div class="progress-stats">
      ${job.filesProcessed} / ${job.filesFound} processed
      &middot; ${job.filesImported} imported
      &middot; ${job.filesSkippedDuplicate} duplicates skipped
      &middot; ${job.filesErrored} errors
      ${job.jobType === "device_import" ? `&middot; ${job.filesDeletedFromDevice} deleted from device` : ""}
    </div>
    ${job.lastError ? `<div class="progress-error">${escapeHtml(job.lastError)}</div>` : ""}
    ${job.status === "stalled" || job.status === "failed" ? `<button data-action="resume-job" data-job-id="${job.id}">Resume</button>` : ""}
  `;
}

export function pollJob(jobId: number, onUpdate: (job: ImportJobRecord) => void): ProgressHandle {
  let stopped = false;
  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const job = await getJob(jobId);
      onUpdate(job);
      if (job.status === "running" || job.status === "pending") {
        setTimeout(tick, 1000);
      }
    } catch {
      if (!stopped) setTimeout(tick, 2000);
    }
  }
  void tick();
  return { stop: () => (stopped = true) };
}

// One delegated listener for the whole document handles Resume clicks for
// any progress panel, rather than every view re-wiring its own.
document.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action=resume-job]");
  if (!button) return;
  const jobId = Number(button.dataset.jobId);
  const container = button.closest<HTMLElement>(".progress-status")?.parentElement ?? (button.parentElement as HTMLElement);
  void resumeJob(jobId).then(() => pollJob(jobId, (job) => renderProgress(container, job)));
});

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
