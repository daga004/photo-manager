import { listDevices, startDeviceImport, startImport } from "../api.ts";
import { pollJob, renderProgress } from "../components/progressBar.ts";
import type { DeviceInfo, ImportJobRecord } from "../../shared/types.ts";

export async function renderImport(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2>Import</h2>
    <section class="import-section">
      <h3>From a folder</h3>
      <p class="hint">Works for a Mac folder or a DSLR SD card mounted via a card reader — files are moved and organized into photos|videos/YYYY/MM/DD.</p>
      <input type="text" id="folder-path" placeholder="/path/to/folder" />
      <button id="start-folder-import">Import</button>
    </section>
    <section class="import-section">
      <h3>From a connected iPhone</h3>
      <div id="device-list">Checking for connected devices…</div>
    </section>
    <div id="import-progress"></div>
  `;

  const progressContainer = container.querySelector<HTMLElement>("#import-progress");
  const folderInput = container.querySelector<HTMLInputElement>("#folder-path");
  const folderButton = container.querySelector<HTMLButtonElement>("#start-folder-import");
  const deviceListContainer = container.querySelector<HTMLElement>("#device-list");
  if (!progressContainer || !folderInput || !folderButton || !deviceListContainer) return;

  folderButton.addEventListener("click", async () => {
    const sourcePath = folderInput.value.trim();
    if (!sourcePath) return;
    folderButton.disabled = true;
    try {
      const { jobId } = await startImport(sourcePath);
      watchJob(jobId, progressContainer);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      folderButton.disabled = false;
    }
  });

  try {
    const devices = await listDevices();
    renderDeviceList(deviceListContainer, devices, progressContainer);
  } catch {
    deviceListContainer.innerHTML = `<p class="empty-state">Could not check for connected devices.</p>`;
  }
}

function renderDeviceList(container: HTMLElement, devices: DeviceInfo[], progressContainer: HTMLElement): void {
  if (devices.length === 0) {
    container.innerHTML = `<p class="empty-state">No iPhone connected. Plug in via cable (or use Wi-Fi sync once paired in Finder) and reload this page.</p>`;
    return;
  }
  container.innerHTML = devices
    .map(
      (d) => `<div class="device-card" data-udid="${d.udid}">
        <div>${escapeAttr(d.name)} &middot; iOS ${escapeAttr(d.iosVersion)} &middot; ${d.connectionType}</div>
        <label><input type="checkbox" class="delete-after-verify" checked /> Delete from iPhone after verified copy (frees storage now; permanent, no 30-day undo)</label>
        <button data-action="import-device">Import from this iPhone</button>
      </div>`,
    )
    .join("");

  container.addEventListener("click", async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action=import-device]");
    if (!button) return;
    const card = button.closest<HTMLElement>(".device-card");
    if (!card?.dataset.udid) return;
    const udid = card.dataset.udid;
    const deleteCheckbox = card.querySelector<HTMLInputElement>(".delete-after-verify");
    const deleteAfterVerify = deleteCheckbox?.checked ?? false;

    if (deleteAfterVerify) {
      const ok = confirm(
        "This will copy every photo/video off the iPhone, verify each one, then PERMANENTLY delete the originals from the phone (no 30-day undo).\n\n" +
          "Note: the Photos app may keep showing blurry/low-res thumbnails for deleted photos for a while afterward — this is just a stale index entry, not a failed deletion. The actual storage is freed immediately; force-quitting and reopening the Photos app (or restarting the phone) clears the stale thumbnails.\n\n" +
          "Continue?",
      );
      if (!ok) return;
    }

    button.disabled = true;
    try {
      const { jobId } = await startDeviceImport(udid, deleteAfterVerify);
      watchJob(jobId, progressContainer);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      button.disabled = false;
    }
  });
}

function watchJob(jobId: number, container: HTMLElement): void {
  pollJob(jobId, (job: ImportJobRecord) => renderProgress(container, job));
}

function escapeAttr(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
