import { getDuplicates, resolveDuplicate } from "../api.ts";
import { formatBytes } from "./dayListView.ts";
import type { DuplicateGroup } from "../../shared/types.ts";

export async function renderDuplicates(container: HTMLElement): Promise<void> {
  container.innerHTML = `<h2>Duplicates</h2><div id="dup-list">Loading…</div>`;
  const listContainer = container.querySelector<HTMLElement>("#dup-list");
  if (!listContainer) return;

  async function load(): Promise<void> {
    const groups = await getDuplicates(false);
    if (!listContainer) return;
    renderGroups(listContainer, groups);
  }

  listContainer.addEventListener("click", async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!button) return;
    const group = button.closest<HTMLElement>(".dup-group");
    if (!group?.dataset.hash) return;
    const contentHash = group.dataset.hash;
    const action = button.dataset.action;
    const selected = group.querySelector<HTMLInputElement>(`input[name="keep-${cssEscape(contentHash)}"]:checked`);

    if (action === "delete-extras") {
      if (!selected) return;
      const keepMediaId = Number(selected.value);
      const itemCount = group.querySelectorAll(".dup-item").length;
      if (!confirm(`Permanently delete ${itemCount - 1} duplicate file(s), keeping the selected one? This cannot be undone.`)) {
        return;
      }
      await resolveDuplicate(contentHash, keepMediaId, "delete_extras");
      await load();
    } else if (action === "ignore" && selected) {
      await resolveDuplicate(contentHash, Number(selected.value), "ignore");
      await load();
    }
  });

  await load();
}

function renderGroups(container: HTMLElement, groups: DuplicateGroup[]): void {
  if (groups.length === 0) {
    container.innerHTML = `<p class="empty-state">No duplicates found.</p>`;
    return;
  }
  container.innerHTML = groups
    .map(
      (g) => `<div class="dup-group" data-hash="${g.contentHash}">
        <div class="dup-group-header">
          ${g.count} copies &middot; ${formatBytes(g.sizeBytes)} each &middot;
          ${formatBytes(g.sizeBytes * (g.count - 1))} reclaimable
        </div>
        <div class="dup-items">
          ${g.items
            .map(
              (item, i) => `<div class="dup-item">
                <img src="${item.thumbnailUrl}" alt="${escapeAttr(item.filename)}" />
                <label><input type="radio" name="keep-${g.contentHash}" value="${item.id}" ${i === 0 ? "checked" : ""} /> Keep</label>
                <div class="dup-item-meta">${escapeAttr(item.filename)}<br />${escapeAttr(item.path)}</div>
              </div>`,
            )
            .join("")}
        </div>
        <div class="dup-group-actions">
          <button data-action="delete-extras">Delete extras (keep selected)</button>
          <button data-action="ignore">Ignore this group</button>
        </div>
      </div>`,
    )
    .join("");
}

function escapeAttr(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function cssEscape(s: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s;
}
