import { getNonCamera } from "../api.ts";
import { renderThumbnailGrid } from "../components/thumbnailGrid.ts";
import { openMediaViewer } from "./mediaViewerView.ts";

export async function renderNonCamera(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="day-detail-header"><a href="#/days">&larr; Back to days</a><h2>Non-camera</h2></div>
    <p class="hint">Images without camera EXIF metadata &mdash; typically WhatsApp, downloads, and screenshots rather than genuinely-clicked photos. Kept separate from the camera timeline.</p>
    <div id="grid"></div>
  `;
  const grid = container.querySelector<HTMLElement>("#grid");
  if (!grid) return;
  const { items } = await getNonCamera();
  if (items.length === 0) {
    grid.innerHTML = `<p class="empty-state">No non-camera images.</p>`;
    return;
  }
  renderThumbnailGrid(grid, { items, onItemClick: (_i, index) => openMediaViewer(items, index) });
}
