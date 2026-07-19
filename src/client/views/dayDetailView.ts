import { getDayItems } from "../api.ts";
import { renderThumbnailGrid } from "../components/thumbnailGrid.ts";
import { openMediaViewer } from "./mediaViewerView.ts";

export async function renderDayDetail(container: HTMLElement, date: string): Promise<void> {
  container.innerHTML = `
    <div class="day-detail-header"><a href="#/days">&larr; Back to days</a><h2>${date}</h2></div>
    <div id="grid"></div>
  `;
  const gridContainer = container.querySelector<HTMLElement>("#grid");
  if (!gridContainer) return;

  const { items } = await getDayItems(date);
  if (items.length === 0) {
    gridContainer.innerHTML = `<p class="empty-state">No items for this day.</p>`;
    return;
  }

  renderThumbnailGrid(gridContainer, {
    items,
    onItemClick: (_item, index) => openMediaViewer(items, index),
  });
}
