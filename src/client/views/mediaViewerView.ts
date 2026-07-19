import type { DayItem } from "../../shared/types.ts";

export function openMediaViewer(items: DayItem[], startIndex: number): void {
  let index = startIndex;
  const overlay = document.createElement("div");
  overlay.className = "media-viewer-overlay";
  document.body.appendChild(overlay);

  function render(): void {
    const item = items[index];
    if (!item) return;
    const mediaEl =
      item.mediaType === "photo"
        ? `<img src="/api/media/${item.id}/full" alt="${escapeAttr(item.filename)}" />`
        : `<video src="/api/media/${item.id}/full" controls autoplay></video>`;
    overlay.innerHTML = `
      <button class="viewer-close" data-action="close" aria-label="Close">&times;</button>
      <button class="viewer-prev" data-action="prev" ${index === 0 ? "disabled" : ""} aria-label="Previous">&larr;</button>
      <div class="viewer-media">${mediaEl}</div>
      <button class="viewer-next" data-action="next" ${index === items.length - 1 ? "disabled" : ""} aria-label="Next">&rarr;</button>
      <div class="viewer-filename">${escapeAttr(item.filename)} (${index + 1} / ${items.length})</div>
    `;
  }

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft" && index > 0) {
      index--;
      render();
    } else if (e.key === "ArrowRight" && index < items.length - 1) {
      index++;
      render();
    }
  }

  overlay.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).dataset.action;
    if (action === "close") close();
    else if (action === "prev" && index > 0) {
      index--;
      render();
    } else if (action === "next" && index < items.length - 1) {
      index++;
      render();
    }
  });

  document.addEventListener("keydown", onKeyDown);
  render();
}

function escapeAttr(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
