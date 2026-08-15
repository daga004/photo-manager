import { getDayItems, openDayFolder } from "../api.ts";
import { renderThumbnailGrid } from "../components/thumbnailGrid.ts";
import { openMediaViewer } from "./mediaViewerView.ts";

export async function renderDayDetail(container: HTMLElement, date: string): Promise<void> {
  container.innerHTML = `
    <div class="day-detail-header">
      <a href="#/days">&larr; Back to days</a>
      <h2>${date}</h2>
      <button id="open-day-folder" title="Open this day's folder in Finder to organize/delete with native tools">Open folder</button>
    </div>
    <div id="grid"></div>
  `;
  const gridContainer = container.querySelector<HTMLElement>("#grid");
  if (!gridContainer) return;

  // Opens the day's on-disk folder(s) in the native file manager for probing,
  // deleting, or handing off to another app.
  container.querySelector<HTMLButtonElement>("#open-day-folder")?.addEventListener("click", async (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await openDayFolder(date);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      button.disabled = false;
    }
  });

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
