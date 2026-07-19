import { getDuplicates, resolveDuplicate } from "../api.ts";
import { formatBytes } from "./dayListView.ts";
import type { DuplicateGroup } from "../../shared/types.ts";

/**
 * The file to keep by default in a duplicate group: the one with the SHORTEST
 * filename. A copy almost always adds a prefix/suffix ("IMG_0001 copy.jpg",
 * "IMG_0001__dup2.jpg"), so the shortest name is usually the original. Ties
 * break on shortest path, then lowest id, for a stable choice.
 */
function defaultKeepId(group: DuplicateGroup): number {
  return [...group.items].sort(
    (a, b) =>
      a.filename.length - b.filename.length ||
      a.path.length - b.path.length ||
      a.id - b.id,
  )[0]!.id;
}

export async function renderDuplicates(container: HTMLElement): Promise<void> {
  container.innerHTML = `<h2>Duplicates</h2><div id="dup-toolbar"></div><div id="dup-list">Loading…</div>`;
  const toolbar = container.querySelector<HTMLElement>("#dup-toolbar");
  const listContainer = container.querySelector<HTMLElement>("#dup-list");
  if (!toolbar || !listContainer) return;

  async function load(): Promise<void> {
    const groups = await getDuplicates(false);
    if (!toolbar || !listContainer) return;
    renderToolbar(toolbar, groups);
    renderGroups(listContainer, groups);
  }

  // "Delete all" resolves every visible group at once, keeping whichever file
  // is currently selected in each (defaulting to the shortest name).
  toolbar.addEventListener("click", async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action=delete-all]");
    if (!button || !listContainer) return;
    const groupEls = Array.from(listContainer.querySelectorAll<HTMLElement>(".dup-group"));
    if (groupEls.length === 0) return;

    const totalExtras = groupEls.reduce((sum, el) => sum + el.querySelectorAll(".dup-item").length - 1, 0);
    if (!confirm(`Permanently delete ${totalExtras} duplicate file(s) across ${groupEls.length} group(s), keeping the selected file in each? This cannot be undone.`)) {
      return;
    }

    // Collect the work up front (hash + kept id per group) so live progress can
    // be shown as each group is verified-and-quarantined server-side.
    const jobs: Array<{ contentHash: string; keepMediaId: number }> = [];
    for (const el of groupEls) {
      const contentHash = el.dataset.hash;
      const selected = el.querySelector<HTMLInputElement>('input[type=radio]:checked');
      if (contentHash && selected) jobs.push({ contentHash, keepMediaId: Number(selected.value) });
    }

    const progress = renderBulkProgress(toolbar!, jobs.length);
    button.disabled = true;
    let quarantined = 0;
    let errors = 0;
    try {
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i]!;
        try {
          const res = await resolveDuplicate(j.contentHash, j.keepMediaId, "delete_extras");
          quarantined += res.quarantinedCount ?? 0;
          errors += res.failed?.length ?? 0;
        } catch {
          errors++;
        }
        progress.update(i + 1, quarantined, errors);
      }
    } finally {
      await load();
      const parts = [`Deleted ${quarantined} duplicate file(s)`];
      if (errors > 0) parts.push(`${errors} could not be moved (originals kept)`);
      alert(parts.join(". ") + ".");
    }
  });

  listContainer.addEventListener("click", async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!button) return;
    const group = button.closest<HTMLElement>(".dup-group");
    if (!group?.dataset.hash) return;
    const contentHash = group.dataset.hash;
    const action = button.dataset.action;
    const selected = group.querySelector<HTMLInputElement>('input[type=radio]:checked');

    if (action === "delete-extras") {
      if (!selected) return;
      const keepMediaId = Number(selected.value);
      const itemCount = group.querySelectorAll(".dup-item").length;
      if (!confirm(`Permanently delete ${itemCount - 1} duplicate file(s), keeping the selected one? This cannot be undone.`)) {
        return;
      }
      button.disabled = true;
      try {
        const res = await resolveDuplicate(contentHash, keepMediaId, "delete_extras");
        if (res.failed?.length) {
          alert(`${res.failed.length} file(s) could not be moved and were left in place (originals kept).`);
        }
        await load();
      } catch (err) {
        alert(`Delete failed (originals kept, nothing lost): ${err instanceof Error ? err.message : String(err)}`);
        button.disabled = false;
      }
    } else if (action === "ignore" && selected) {
      try {
        await resolveDuplicate(contentHash, Number(selected.value), "ignore");
        await load();
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    }
  });

  await load();
}

/**
 * Replaces the toolbar with a live progress readout for the bulk "delete all"
 * operation, returning an `update` callback the loop calls after each group.
 * (Each group is a separate request because the server byte-verifies every
 * candidate before quarantining it, so this genuinely takes time on big sets.)
 */
function renderBulkProgress(
  container: HTMLElement,
  totalGroups: number,
): { update: (done: number, quarantined: number, errors: number) => void } {
  container.innerHTML = `
    <div class="dup-bulk-progress">
      <div class="progress-bar"><div class="progress-bar-fill" id="dup-bulk-fill" style="width:0%"></div></div>
      <div class="progress-stats" id="dup-bulk-stats">Starting… 0 / ${totalGroups} groups</div>
      <p class="hint dup-verify-note">
        Duplicates are found with a fast approximate fingerprint. Deleting moves the extras to a
        restorable quarantine (not a permanent erase), so your explicit choice is honored right away
        and anything can be recovered if needed.
      </p>
    </div>
  `;
  const fill = container.querySelector<HTMLElement>("#dup-bulk-fill");
  const stats = container.querySelector<HTMLElement>("#dup-bulk-stats");
  return {
    update(done, quarantined, errors) {
      const pct = totalGroups > 0 ? Math.round((done / totalGroups) * 100) : 100;
      if (fill) fill.style.width = `${pct}%`;
      if (stats) {
        stats.textContent =
          `${done} / ${totalGroups} groups` +
          ` · ${quarantined} deleted` +
          (errors > 0 ? ` · ${errors} could not be moved` : "");
      }
    },
  };
}

function renderToolbar(container: HTMLElement, groups: DuplicateGroup[]): void {
  if (groups.length === 0) {
    container.innerHTML = "";
    return;
  }
  const reclaimable = groups.reduce((sum, g) => sum + g.sizeBytes * (g.count - 1), 0);
  container.innerHTML = `
    <div class="dup-toolbar-row">
      <span>${groups.length} duplicate group(s) &middot; ${formatBytes(reclaimable)} reclaimable</span>
      <button data-action="delete-all" class="danger">Delete all duplicates (keep selected in each)</button>
    </div>
    <p class="hint">Default keeps the shortest filename in each group (usually the original). Change the selection per group below before deleting if you want to keep a different copy.</p>
    <p class="hint">Groups are found by a fast approximate fingerprint. Deleting moves the extras to a restorable quarantine, so it's honored immediately and anything can be recovered if needed.</p>
  `;
}

function renderGroups(container: HTMLElement, groups: DuplicateGroup[]): void {
  if (groups.length === 0) {
    container.innerHTML = `<p class="empty-state">No duplicates found.</p>`;
    return;
  }
  container.innerHTML = groups
    .map((g) => {
      const keepId = defaultKeepId(g);
      return `<div class="dup-group" data-hash="${g.contentHash}">
        <div class="dup-group-header">
          ${g.count} copies &middot; ${formatBytes(g.sizeBytes)} each &middot;
          ${formatBytes(g.sizeBytes * (g.count - 1))} reclaimable
        </div>
        <div class="dup-items">
          ${g.items
            .map(
              (item) => `<div class="dup-item">
                <img src="${item.thumbnailUrl}" alt="${escapeAttr(item.filename)}" />
                <label><input type="radio" name="keep-${g.contentHash}" value="${item.id}" ${item.id === keepId ? "checked" : ""} /> Keep</label>
                <div class="dup-item-meta">${escapeAttr(item.filename)}<br />${escapeAttr(item.path)}</div>
              </div>`,
            )
            .join("")}
        </div>
        <div class="dup-group-actions">
          <button data-action="delete-extras">Delete extras (keep selected)</button>
          <button data-action="ignore">Ignore this group</button>
        </div>
      </div>`;
    })
    .join("");
}

function escapeAttr(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
