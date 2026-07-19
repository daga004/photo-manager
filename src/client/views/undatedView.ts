import { getUndated } from "../api.ts";
import { renderThumbnailGrid } from "../components/thumbnailGrid.ts";
import { openMediaViewer } from "./mediaViewerView.ts";

export async function renderUndated(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="day-detail-header"><a href="#/days">&larr; Back to days</a><h2>Undated</h2></div>
    <p class="hint">Files with no recoverable capture date (no EXIF, no date in the filename). Stored under <code>photos|videos/undated/</code> and kept out of the date timeline.</p>
    <div id="grid"></div>
  `;
  const grid = container.querySelector<HTMLElement>("#grid");
  if (!grid) return;

  const { items } = await getUndated();
  if (items.length === 0) {
    grid.innerHTML = `<p class="empty-state">No undated files.</p>`;
    return;
  }
  renderThumbnailGrid(grid, { items, onItemClick: (_i, index) => openMediaViewer(items, index) });
}
