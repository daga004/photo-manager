import { getQuarantineInfo, getSettings, purgeQuarantine, updateLibraryRoot } from "../api.ts";
import { formatBytes } from "./dayListView.ts";

export async function renderSettings(container: HTMLElement): Promise<void> {
  container.innerHTML = `<h2>Settings</h2><div id="settings-body">Loading…</div>`;
  const body = container.querySelector<HTMLElement>("#settings-body");
  if (!body) return;

  const s = await getSettings();

  body.innerHTML = `
    <section class="import-section">
      <h3>Library root</h3>
      <p class="hint">
        The root folder where all photos and videos are stored, organized as
        <code>photos/YYYY/MM/DD</code> and <code>videos/YYYY/MM/DD</code>.
        Point this at an external drive (ideally a RAID for durability) to keep
        your library off the Mac's internal storage.
      </p>
      <p class="hint">Currently: <code>${escape(s.libraryRoot)}</code> ${s.isDefault ? "(default)" : "(configured)"}</p>
      <div class="settings-row">
        <input type="text" id="library-root-input" value="${escape(s.libraryRoot)}" placeholder="/Volumes/YourDrive" />
        <button id="save-library-root">Save</button>
      </div>
      <div class="settings-warn">
        Changing this after files are already indexed does <strong>not</strong> move existing files or
        update already-indexed entries (which point at the old location). Set it once before importing,
        or run a fresh reindex against the new location afterward.
      </div>
      <div id="settings-msg"></div>
      <p class="hint" style="margin-top:1rem">
        Photos dir: <code>${escape(s.photosDir)}</code><br />
        Videos dir: <code>${escape(s.videosDir)}</code><br />
        Data dir (index + thumbnails): <code>${escape(s.dataDir)}</code>
      </p>
    </section>

    <section class="import-section">
      <h3>Quarantine</h3>
      <p class="hint">
        Deleted items aren't erased — they're moved here so they stay restorable:
        duplicates removed in the Duplicates view, files skipped as duplicates during
        import, and single files deleted from the viewer. Purging <strong>permanently</strong>
        deletes them and frees the space.
      </p>
      <div id="quarantine-info">Loading quarantine size…</div>
      <div id="quarantine-purge"></div>
    </section>
  `;

  wireLibraryRoot(container, body);
  await renderQuarantine(body);
}

function wireLibraryRoot(container: HTMLElement, body: HTMLElement): void {
  const input = body.querySelector<HTMLInputElement>("#library-root-input");
  const button = body.querySelector<HTMLButtonElement>("#save-library-root");
  const msg = body.querySelector<HTMLElement>("#settings-msg");
  if (!input || !button || !msg) return;

  button.addEventListener("click", async () => {
    const value = input.value.trim();
    if (!value) return;
    button.disabled = true;
    msg.textContent = "";
    msg.className = "";
    try {
      await updateLibraryRoot(value);
      msg.textContent = "Saved. New imports and reindexes will use this location.";
      msg.className = "settings-ok";
      await renderSettings(container);
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
      msg.className = "progress-error";
      button.disabled = false;
    }
  });
}

/** Fetches quarantine size and renders the breakdown + the staged purge control. */
async function renderQuarantine(body: HTMLElement): Promise<void> {
  const infoEl = body.querySelector<HTMLElement>("#quarantine-info");
  const purgeEl = body.querySelector<HTMLElement>("#quarantine-purge");
  if (!infoEl || !purgeEl) return;

  let info;
  try {
    info = await getQuarantineInfo();
  } catch (err) {
    infoEl.innerHTML = `<p class="progress-error">${escape(err instanceof Error ? err.message : String(err))}</p>`;
    return;
  }

  const rows = info.categories
    .map((c) => `<div class="quarantine-cat"><span>${escape(prettyName(c.name))}</span><span>${c.files} file(s) &middot; ${formatBytes(c.bytes)}</span></div>`)
    .join("");
  infoEl.innerHTML = `
    <div class="quarantine-total">${info.totalFiles} file(s) &middot; <strong>${formatBytes(info.totalBytes)}</strong> reclaimable</div>
    <div class="quarantine-breakdown">${rows}</div>
  `;

  if (info.totalFiles === 0) {
    purgeEl.innerHTML = `<p class="hint">Quarantine is empty — nothing to purge.</p>`;
    return;
  }

  // Stage 1: just a button. Clicking it reveals the confirm box (stage 2).
  purgeEl.innerHTML = `<button id="purge-start" class="danger">Purge quarantine…</button>`;
  purgeEl.querySelector<HTMLButtonElement>("#purge-start")?.addEventListener("click", () => {
    renderPurgeConfirm(purgeEl, info!.totalFiles, info!.totalBytes, body);
  });
}

/** Stage 2: an explicit checkbox the user must tick before the purge button
 * enables, then (stage 3) a final native confirm() before anything is deleted. */
function renderPurgeConfirm(purgeEl: HTMLElement, totalFiles: number, totalBytes: number, body: HTMLElement): void {
  purgeEl.innerHTML = `
    <div class="purge-confirm">
      <p class="settings-warn">
        This permanently deletes <strong>${totalFiles} file(s)</strong> (${formatBytes(totalBytes)}) from quarantine and
        removes their index entries. <strong>This cannot be undone.</strong>
      </p>
      <label class="purge-ack"><input type="checkbox" id="purge-ack" /> I understand this permanently deletes ${totalFiles} file(s) (${formatBytes(totalBytes)}) and cannot be undone.</label>
      <div class="purge-actions">
        <button id="purge-cancel">Cancel</button>
        <button id="purge-go" class="danger" disabled>Permanently purge</button>
      </div>
      <div id="purge-msg"></div>
    </div>
  `;
  const ack = purgeEl.querySelector<HTMLInputElement>("#purge-ack");
  const go = purgeEl.querySelector<HTMLButtonElement>("#purge-go");
  const cancel = purgeEl.querySelector<HTMLButtonElement>("#purge-cancel");
  const msg = purgeEl.querySelector<HTMLElement>("#purge-msg");
  if (!ack || !go || !cancel || !msg) return;

  ack.addEventListener("change", () => {
    go.disabled = !ack.checked;
  });

  cancel.addEventListener("click", () => void renderQuarantine(body));

  go.addEventListener("click", async () => {
    if (!ack.checked) return;
    // Stage 3: final OS confirm — a deliberate second, separate action.
    if (!confirm(`Permanently delete ${totalFiles} file(s) (${formatBytes(totalBytes)}) from quarantine? This cannot be undone.`)) {
      return;
    }
    go.disabled = true;
    cancel.disabled = true;
    msg.textContent = "Purging…";
    msg.className = "";
    try {
      const res = await purgeQuarantine();
      msg.textContent = `Purged ${res.deletedEntries} item(s) and cleaned ${res.removedRows} index entr(ies).`;
      msg.className = "settings-ok";
      // Refresh the size readout (now empty).
      await renderQuarantine(body);
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
      msg.className = "progress-error";
      go.disabled = false;
      cancel.disabled = false;
    }
  });
}

function prettyName(name: string): string {
  if (name === "duplicates") return "Duplicates removed";
  if (name === "import-duplicates") return "Import duplicates";
  if (name === "deleted") return "Deleted from viewer";
  return name;
}

function escape(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
