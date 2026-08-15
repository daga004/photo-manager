import { getQuarantinedMedia, restoreMedia, type QuarantinedItem } from "../api.ts";

/**
 * Recover view: lists soft-deleted (quarantined) media — items removed from the
 * viewer or as duplicates — each with a one-click Restore that moves the file
 * back to the library and re-activates its index row.
 */
export async function renderRecover(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="day-detail-header">
      <a href="#/settings">&larr; Settings</a>
      <h2>Recover deleted items</h2>
    </div>
    <p class="hint">Deleted files aren't erased — they're kept in quarantine and can be restored here. (Permanently freeing the space is done via Settings → Quarantine → Purge.)</p>
    <div id="recover-list">Loading…</div>
  `;
  const list = container.querySelector<HTMLElement>("#recover-list");
  if (!list) return;

  async function load(): Promise<void> {
    if (!list) return;
    let items: QuarantinedItem[];
    try {
      items = await getQuarantinedMedia();
    } catch (err) {
      list.innerHTML = `<p class="error-state">${escapeAttr(err instanceof Error ? err.message : String(err))}</p>`;
      return;
    }
    if (items.length === 0) {
      list.innerHTML = `<p class="empty-state">Nothing in quarantine — no deleted items to recover.</p>`;
      return;
    }
    list.innerHTML = `
      <p class="hint">${items.length} recoverable item(s).</p>
      <div class="recover-grid">
        ${items.map(renderCard).join("")}
      </div>
    `;
  }

  // One delegated handler restores an item and drops its card on success.
  list.addEventListener("click", async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action=restore]");
    if (!button) return;
    const id = Number(button.dataset.id);
    if (Number.isNaN(id)) return;
    button.disabled = true;
    button.textContent = "Restoring…";
    try {
      await restoreMedia(id);
      button.closest<HTMLElement>(".recover-card")?.remove();
      // If that emptied the list, re-render the empty state.
      if (!list.querySelector(".recover-card")) await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      button.disabled = false;
      button.textContent = "Restore";
    }
  });

  await load();
}

function renderCard(item: QuarantinedItem): string {
  return `<div class="recover-card" data-id="${item.id}">
    <img class="recover-thumb" src="${item.thumbnailUrl}" alt="${escapeAttr(item.filename)}" decoding="async" loading="lazy" />
    <div class="recover-meta">
      <div class="recover-name" title="${escapeAttr(item.filename)}">${escapeAttr(item.filename)}</div>
      <div class="recover-reason">${escapeAttr(item.reason ?? "deleted")}</div>
    </div>
    <button data-action="restore" data-id="${item.id}">Restore</button>
  </div>`;
}

function escapeAttr(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
