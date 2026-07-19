import { listJobs, startReindex } from "../api.ts";
import { pollJob, renderProgress } from "../components/progressBar.ts";
import type { ImportJobRecord } from "../../shared/types.ts";

export async function renderReindex(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2>Reindex library</h2>
    <p class="hint">Walks the existing library in place and indexes anything not already tracked. Never moves files. Safe to re-run — already-indexed files are skipped quickly, so an interrupted reindex resumes rather than starting over.</p>
    <button id="start-reindex">Start reindex</button>
    <div id="reindex-progress"></div>
  `;

  const progressContainer = container.querySelector<HTMLElement>("#reindex-progress");
  const startButton = container.querySelector<HTMLButtonElement>("#start-reindex");
  if (!progressContainer || !startButton) return;

  startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    try {
      const { jobId } = await startReindex();
      pollJob(jobId, (job: ImportJobRecord) => renderProgress(progressContainer, job));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      startButton.disabled = false;
    }
  });

  const jobs = await listJobs(10);
  const lastReindex = jobs.find((j) => j.jobType === "reindex");
  if (lastReindex) {
    renderProgress(progressContainer, lastReindex);
    if (lastReindex.status === "running" || lastReindex.status === "pending") {
      pollJob(lastReindex.id, (job: ImportJobRecord) => renderProgress(progressContainer, job));
    }
  }
}
