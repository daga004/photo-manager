import { getSettings, updateLibraryRoot } from "../api.ts";

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
  `;

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

function escape(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
