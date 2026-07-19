import { getDays, getUndated } from "../api.ts";
import { renderQuickJump } from "../components/quickJump.ts";
import type { DayAggregate } from "../../shared/types.ts";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export async function renderDayList(container: HTMLElement, navigate: (path: string) => void): Promise<void> {
  container.innerHTML = `
    <div class="toolbar">
      <div id="quick-jump"></div>
      <div class="sort-controls">
        Sort by:
        <select id="sort-by">
          <option value="count">Item count</option>
          <option value="size">Total size</option>
        </select>
        <select id="sort-order">
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
        Type:
        <select id="type-filter">
          <option value="all">All</option>
          <option value="photo">Photos</option>
          <option value="video">Videos</option>
        </select>
      </div>
    </div>
    <div id="day-list-table"></div>
  `;

  const sortBySelect = container.querySelector<HTMLSelectElement>("#sort-by");
  const sortOrderSelect = container.querySelector<HTMLSelectElement>("#sort-order");
  const typeSelect = container.querySelector<HTMLSelectElement>("#type-filter");
  const tableContainer = container.querySelector<HTMLElement>("#day-list-table");
  const quickJumpContainer = container.querySelector<HTMLElement>("#quick-jump");
  if (!sortBySelect || !sortOrderSelect || !typeSelect || !tableContainer || !quickJumpContainer) return;

  async function load(): Promise<void> {
    const sortBy = (sortBySelect?.value === "size" ? "size" : "count") as "count" | "size";
    const order = (sortOrderSelect?.value === "asc" ? "asc" : "desc") as "asc" | "desc";
    const typeValue = typeSelect?.value;
    const type = (typeValue === "photo" || typeValue === "video" ? typeValue : "all") as "photo" | "video" | "all";
    const [days, undated] = await Promise.all([getDays(sortBy, order, type), getUndated().catch(() => ({ count: 0 }))]);
    if (!tableContainer || !quickJumpContainer) return;
    renderTable(tableContainer, days, navigate);
    renderQuickJump(quickJumpContainer, days, (date) => navigate(`#/days/${date}`));
    if (undated.count > 0) {
      const banner = document.createElement("div");
      banner.className = "undated-banner";
      banner.innerHTML = `<a href="#/undated">Undated (${undated.count}) &mdash; files with no recoverable date &rarr;</a>`;
      tableContainer.prepend(banner);
    }
  }

  sortBySelect.addEventListener("change", () => void load());
  sortOrderSelect.addEventListener("change", () => void load());
  typeSelect.addEventListener("change", () => void load());

  await load();
}

function renderTable(container: HTMLElement, days: DayAggregate[], navigate: (path: string) => void): void {
  if (days.length === 0) {
    container.innerHTML = `<p class="empty-state">No media indexed yet. Run a <a href="#/reindex">reindex</a> or <a href="#/import">import</a> to get started.</p>`;
    return;
  }
  const rows = days
    .map(
      (d) => `<tr data-date="${d.date}">
        <td>${d.date}</td>
        <td>${d.itemCount}</td>
        <td>${d.photoCount}</td>
        <td>${d.videoCount}</td>
        <td>${formatBytes(d.totalSizeBytes)}</td>
      </tr>`,
    )
    .join("");
  container.innerHTML = `<table class="day-table">
    <thead><tr><th>Date</th><th>Items</th><th>Photos</th><th>Videos</th><th>Size</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  container.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-date]");
    if (row?.dataset.date) navigate(`#/days/${row.dataset.date}`);
  });
}
