import type { DayItem } from "../../shared/types.ts";

export interface ThumbnailGridOptions {
  items: DayItem[];
  /** Single-click activation (used by the non-camera/undated views). */
  onItemClick?: (item: DayItem, index: number) => void;
  /** Double-click activation (the day view uses this to open the fullscreen viewer). */
  onItemDoubleClick?: (item: DayItem, index: number) => void;
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
    // Decode off the main thread so a screenful of thumbnails decoding at once
    // doesn't jank scrolling.
    img.decoding = "async";
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

  const resolve = (e: Event): { item: DayItem; index: number } | null => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>(".thumb-cell");
    if (!cell) return null;
    const index = Number(cell.dataset.index);
    const item = options.items[index];
    return item ? { item, index } : null;
  };

  // When both handlers exist, a click must wait briefly to see if it's really the
  // first half of a double-click — otherwise single-click (open) would always fire
  // before double-click (fullscreen). A dblclick cancels the pending single-click.
  const bothProvided = Boolean(options.onItemClick && options.onItemDoubleClick);
  let pendingClick: ReturnType<typeof setTimeout> | null = null;

  if (options.onItemClick || options.onItemDoubleClick) {
    container.addEventListener("click", (e) => {
      const r = resolve(e);
      if (!r) return;
      if (bothProvided) {
        if (pendingClick) return;
        pendingClick = setTimeout(() => {
          pendingClick = null;
          options.onItemClick?.(r.item, r.index);
        }, 250);
      } else {
        options.onItemClick?.(r.item, r.index);
      }
    });
  }
  if (options.onItemDoubleClick) {
    container.addEventListener("dblclick", (e) => {
      const r = resolve(e);
      if (!r) return;
      if (pendingClick) {
        clearTimeout(pendingClick);
        pendingClick = null;
      }
      options.onItemDoubleClick!(r.item, r.index);
    });
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
