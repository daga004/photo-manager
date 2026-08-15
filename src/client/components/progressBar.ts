import { getJob, pauseJob, resumeJob } from "../api.ts";
import { formatBytes } from "../views/dayListView.ts";
import type { ActiveTransfer, ImportJobRecord } from "../../shared/types.ts";

export interface ProgressHandle {
  stop: () => void;
}

// Formats a bytes/second throughput as a human MB/s figure. Kept separate from
// formatBytes (which auto-scales units) because the transfer-rate headline reads
// more consistently when it always speaks the same unit — MB/s — so a number
// that suddenly halves is obvious at a glance rather than hidden behind a unit
// change (e.g. "900 KB/s" vs "1.1 MB/s"). Falls back to "—" for a not-yet-known
// rate (0 or non-finite) so the headline never shows a misleading "0.0 MB/s".
function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  const mbPerSecond = bytesPerSecond / (1024 * 1024);
  // Sub-1 MB/s still deserves one decimal of precision; above that, one decimal
  // is plenty and avoids jitter in the least-significant digit.
  return `${mbPerSecond.toFixed(mbPerSecond < 10 ? 2 : 1)} MB/s`;
}

// Renders the live, in-flight transfer detail that only a RUNNING import job
// carries (job.progress). Returns "" for reindex/idle/finished jobs so those
// render exactly as before — no regressions. Kept as its own function to keep
// renderProgress's main template readable.
function renderLiveProgress(progress: NonNullable<ImportJobRecord["progress"]>): string {
  const rateLine = `<div class="transfer-rate">${formatRate(progress.bytesPerSecond)} <span class="transfer-rate-label">&middot; ${formatBytes(progress.bytesCopiedTotal)} copied</span></div>`;

  const transfers = progress.activeTransfers.map(renderActiveTransfer).join("");
  const transfersBlock = transfers ? `<div class="active-transfers">${transfers}</div>` : "";

  return `<div class="live-progress">${rateLine}${transfersBlock}</div>`;
}

// Renders the destination folders a file is landing in as a compact, muted line
// like "→ 2019 / 04 / 06". destRelativeDir is "photos|videos/YYYY/MM/DD"; we drop
// the leading media-type segment and surface just the date parts, since a wrong
// capture-date (e.g. a 2024 photo filed under 2019) is exactly what this line is
// meant to make jump out. Returns "" for an empty/malformed dir so nothing renders
// rather than crashing.
function renderTransferDest(destRelativeDir: string): string {
  if (!destRelativeDir) return "";
  // Split off the media-type prefix; the remainder is the YYYY/MM/DD date path.
  const parts = destRelativeDir.split("/").filter(Boolean);
  const dateParts = parts.slice(1);
  if (dateParts.length === 0) return "";
  const dateLabel = dateParts.map(escapeHtml).join(" / ");
  return `<div class="active-transfer-dest">&rarr; ${dateLabel}</div>`;
}

// One active transfer row: filename, destination date folders, size, and a per-file
// mini progress bar driven by bytesCopied / sizeBytes. The mini bar is what makes a
// multi-GB video legible — the aggregate bar barely moves while it copies, but this
// row shows real motion. The destination line makes a mis-dated file obvious live.
function renderActiveTransfer(t: ActiveTransfer): string {
  const filePct = t.sizeBytes > 0 ? Math.min(100, Math.round((t.bytesCopied / t.sizeBytes) * 100)) : 0;
  return `<div class="active-transfer">
      <div class="active-transfer-head">
        <span class="active-transfer-name">${escapeHtml(t.filename)}</span>
        <span class="active-transfer-size">${formatBytes(t.bytesCopied)} / ${formatBytes(t.sizeBytes)}</span>
      </div>
      ${renderTransferDest(t.destRelativeDir)}
      <div class="progress-bar mini"><div class="progress-bar-fill" style="width:${filePct}%"></div></div>
    </div>`;
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
    ${job.progress ? renderLiveProgress(job.progress) : ""}
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
