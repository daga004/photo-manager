import type { DayItem } from "../../shared/types.ts";

export interface ThumbnailGridOptions {
  items: DayItem[];
  onItemClick: (item: DayItem, index: number) => void;
}

/** Lazy-loaded, virtualized-enough thumbnail grid: sets `src` only when a
 * cell scrolls into view, clears it when it scrolls back out, so a day with
 * hundreds of items doesn't keep hundreds of decoded images in memory. */
export function renderThumbnailGrid(container: HTMLElement, options: ThumbnailGridOptions): void {
  container.innerHTML = "";
  container.className = "thumbnail-grid";

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const cell = entry.target as HTMLElement;
        const img = cell.querySelector("img");
        if (!img) continue;
        if (entry.isIntersecting) {
          const src = img.dataset.src;
          if (src && img.getAttribute("src") !== src) img.setAttribute("src", src);
        } else {
          img.removeAttribute("src");
        }
      }
    },
    { rootMargin: "200px" },
  );

  const fragment = document.createDocumentFragment();
  options.items.forEach((item, index) => {
    const cell = document.createElement("div");
    cell.className = "thumb-cell";
    cell.dataset.index = String(index);

    const img = document.createElement("img");
    img.dataset.src = item.thumbnailUrl;
    img.alt = item.filename;
    cell.appendChild(img);

    if (item.mediaType === "video") {
      const badge = document.createElement("span");
      badge.className = "video-badge";
      badge.textContent = item.durationSeconds ? formatDuration(item.durationSeconds) : "▶";
      cell.appendChild(badge);
    }

    fragment.appendChild(cell);
    observer.observe(cell);
  });
  container.appendChild(fragment);

  container.addEventListener("click", (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>(".thumb-cell");
    if (!cell) return;
    const index = Number(cell.dataset.index);
    const item = options.items[index];
    if (item) options.onItemClick(item, index);
  });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
