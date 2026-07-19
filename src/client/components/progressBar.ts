import { getJob, pauseJob, resumeJob } from "../api.ts";
import type { ImportJobRecord } from "../../shared/types.ts";

export interface ProgressHandle {
  stop: () => void;
}

export function renderProgress(container: HTMLElement, job: ImportJobRecord): void {
  const total = job.filesFound;
  // "handled" = files that reached a terminal outcome (moved into the library,
  // skipped as a duplicate, or errored). For a folder/reindex job this is the
  // SLOW copy/index step, so the main bar tracks it — otherwise the bar would
  // read 100% during the fast fingerprint phase while files are still copying.
  const handled = job.filesImported + job.filesSkippedDuplicate + job.filesErrored;
  const isDevice = job.jobType === "device_import";
  // A device import's slow step is the copy off the phone, which filesProcessed
  // tracks; use that for its bar instead.
  const primary = isDevice ? job.filesProcessed : handled;
  const pct = total > 0 ? Math.min(100, Math.round((primary / total) * 100)) : 0;

  const indexingLine =
    !isDevice && total > 0
      ? `<div class="progress-substep">Indexing (fingerprint): ${Math.min(job.filesProcessed, total)} / ${total}</div>`
      : "";

  container.innerHTML = `
    <div class="progress-status">Status: <strong>${job.status}</strong></div>
    <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    <div class="progress-stats">
      ${isDevice ? `${job.filesProcessed} / ${total} copied off device &middot; ` : `${handled} / ${total} ${job.jobType === "reindex" ? "indexed" : "copied into library"} &middot; `}
      ${job.filesImported} ${job.jobType === "reindex" ? "added" : "imported"}
      &middot; ${job.filesSkippedDuplicate} duplicates skipped
      &middot; ${job.filesErrored} errors
      ${isDevice ? `&middot; ${job.filesDeletedFromDevice} deleted from device` : ""}
    </div>
    ${indexingLine}
    ${job.lastError ? `<div class="progress-error">${escapeHtml(job.lastError)}</div>` : ""}
    ${job.status === "running" ? `<button data-action="pause-job" data-job-id="${job.id}">Pause</button>` : ""}
    ${job.status === "stalled" || job.status === "failed" || job.status === "paused" ? `<button data-action="resume-job" data-job-id="${job.id}">Resume</button>` : ""}
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

// One delegated listener for the whole document handles Resume/Pause clicks
// for any progress panel, rather than every view re-wiring its own.
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const resumeBtn = target.closest<HTMLButtonElement>("button[data-action=resume-job]");
  const pauseBtn = target.closest<HTMLButtonElement>("button[data-action=pause-job]");
  const button = resumeBtn ?? pauseBtn;
  if (!button) return;

  const jobId = Number(button.dataset.jobId);
  const container = button.closest<HTMLElement>(".progress-status")?.parentElement ?? (button.parentElement as HTMLElement);
  button.disabled = true;

  const action = resumeBtn ? resumeJob(jobId) : pauseJob(jobId);
  action
    .then(() => pollJob(jobId, (job) => renderProgress(container, job)))
    .catch((err) => {
      alert(err instanceof Error ? err.message : String(err));
      button.disabled = false;
    });
});

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
