import { getDayItems, getDays, openDayFolder } from "../api.ts";
import { renderThumbnailGrid } from "../components/thumbnailGrid.ts";
import { openMediaViewer } from "./mediaViewerView.ts";
import type { DayItem } from "../../shared/types.ts";

export async function renderDayDetail(container: HTMLElement, date: string): Promise<void> {
  container.innerHTML = `
    <div class="day-detail-header">
      <a href="#/days">&larr; Back to days</a>
      <h2>${date}</h2>
      <button id="open-day-folder" title="Open this day's folder in Finder to organize/delete with native tools">Open folder</button>
    </div>
    <p class="hint keyboard-hint">
      Double-click a photo to open it fullscreen. Then:
      <kbd>←</kbd> <kbd>→</kbd> browse within the day &middot;
      <kbd>↑</kbd> <kbd>↓</kbd> previous / next day &middot;
      <kbd>Delete</kbd> remove &middot; <kbd>Esc</kbd> close.
    </p>
    <div id="grid"></div>
  `;
  const gridContainer = container.querySelector<HTMLElement>("#grid");
  if (!gridContainer) return;

  // Opens the day's on-disk folder(s) in the native file manager.
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

  // Resolves the previous/next dated day for the viewer's Up/Down navigation.
  // The ordered date list is fetched once and cached. "prev" = older, "next" = newer.
  let orderedDates: string[] | null = null;
  async function adjacentDate(
    currentDate: string,
    direction: "prev" | "next",
  ): Promise<{ context: { key: string; label: string }; items: DayItem[] } | null> {
    if (!orderedDates) {
      const days = await getDays("count", "desc", "all");
      orderedDates = days.map((d) => d.date).sort(); // ascending = chronological
    }
    const i = orderedDates.indexOf(currentDate);
    if (i === -1) return null;
    const target = direction === "prev" ? orderedDates[i - 1] : orderedDates[i + 1];
    if (!target) return null;
    const res = await getDayItems(target);
    return { context: { key: target, label: target }, items: res.items };
  }

  const openAt = (index: number, fullscreen: boolean): void =>
    openMediaViewer(items, index, {
      fullscreen,
      context: { key: date, label: date },
      collectionNoun: "day",
      onRequestAdjacent: adjacentDate,
      // If the user paged to another day, land the page there so it stays in sync.
      onClose: (finalKey) => {
        if (finalKey && finalKey !== date) location.hash = `#/days/${encodeURIComponent(finalKey)}`;
      },
    });

  renderThumbnailGrid(gridContainer, {
    items,
    onItemClick: (_item, index) => openAt(index, false),
    onItemDoubleClick: (_item, index) => openAt(index, true),
  });
}
