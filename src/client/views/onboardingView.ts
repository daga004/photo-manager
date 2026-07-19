import { getSettings, updateLibraryRoot } from "../api.ts";

/**
 * First-run setup, shown when no library root has been configured yet. Walks
 * the user through choosing where their library lives before they start
 * importing, so files never land somewhere unexpected by default.
 */
export async function renderOnboarding(container: HTMLElement, onDone: () => void): Promise<void> {
  const s = await getSettings();

  container.innerHTML = `
    <div class="onboarding">
      <h1>Welcome to photo-manager</h1>
      <p>Let's set up where your photos and videos will be stored. Pick a folder on
      storage you control — ideally an <strong>external drive with RAID</strong> for
      durability — so your library lives off your Mac's expensive internal storage.</p>

      <ol class="onboarding-steps">
        <li>Point the <strong>library root</strong> at your storage folder.</li>
        <li>Everything gets organized as <code>photos/YYYY/MM/DD</code> and <code>videos/YYYY/MM/DD</code>.</li>
        <li>Then import from a folder, an SD card, or a connected iPhone.</li>
      </ol>

      <div class="settings-row">
        <input type="text" id="onboarding-root" value="${escapeAttr(s.libraryRoot)}" placeholder="/Volumes/YourDrive" />
        <button id="onboarding-save">Save and continue</button>
      </div>
      <div class="settings-warn">The folder must already exist. You can change this later in Settings.</div>
      <div id="onboarding-msg"></div>
    </div>
  `;

  const input = container.querySelector<HTMLInputElement>("#onboarding-root");
  const button = container.querySelector<HTMLButtonElement>("#onboarding-save");
  const msg = container.querySelector<HTMLElement>("#onboarding-msg");
  if (!input || !button || !msg) return;

  button.addEventListener("click", async () => {
    const value = input.value.trim();
    if (!value) return;
    button.disabled = true;
    msg.textContent = "";
    msg.className = "";
    try {
      await updateLibraryRoot(value);
      onDone();
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
      msg.className = "progress-error";
      button.disabled = false;
    }
  });
}

function escapeAttr(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
