import { deleteMedia, openMediaOriginal } from "../api.ts";
import type { DayItem } from "../../shared/types.ts";

const thumbUrl = (id: number) => `/api/media/${id}/thumbnail`;
const previewUrl = (id: number) => `/api/media/${id}/preview`;
const originalUrl = (id: number) => `/api/media/${id}/full`;

export function openMediaViewer(items: DayItem[], startIndex: number): void {
  let index = startIndex;
  const overlay = document.createElement("div");
  overlay.className = "media-viewer-overlay";
  document.body.appendChild(overlay);

  function render(): void {
    const item = items[index];
    if (!item) return;

    if (item.mediaType === "video") {
      // Video streams from the server with Range support; the browser handles
      // progressive playback, so no preview indirection is needed.
      renderShell(
        `<video src="${originalUrl(item.id)}" controls autoplay></video>`,
        item,
      );
    } else {
      // Progressive photo load, nomacs-style: show the already-cached thumbnail
      // instantly (upscaled + slightly blurred) as a placeholder, then swap in
      // the screen-resolution preview the moment it decodes. The preview is a
      // browser-safe JPEG (HEIC/RAW originals wouldn't render) and a fraction
      // of the original's size over the network.
      renderShell(
        `<img class="viewer-img viewer-img-loading" decoding="async" src="${thumbUrl(item.id)}" alt="${escapeAttr(item.filename)}" />`,
        item,
      );
      const imgEl = overlay.querySelector<HTMLImageElement>(".viewer-img");
      if (imgEl) {
        const full = new Image();
        full.onload = () => {
          // Only swap if the user hasn't navigated away in the meantime.
          if (items[index]?.id === item.id) {
            imgEl.src = full.src;
            imgEl.classList.remove("viewer-img-loading");
          }
        };
        full.src = previewUrl(item.id);
      }
    }

    prefetchNeighbors();
  }

  function renderShell(mediaHtml: string, item: DayItem): void {
    overlay.innerHTML = `
      <button class="viewer-close" data-action="close" aria-label="Close">&times;</button>
      <button class="viewer-prev" data-action="prev" ${index === 0 ? "disabled" : ""} aria-label="Previous">&larr;</button>
      <div class="viewer-media">${mediaHtml}</div>
      <button class="viewer-next" data-action="next" ${index === items.length - 1 ? "disabled" : ""} aria-label="Next">&rarr;</button>
      <div class="viewer-footer">
        <span class="viewer-filename">${escapeAttr(item.filename)} (${index + 1} / ${items.length})</span>
        <button class="viewer-action" data-action="open-original">Open original</button>
        <button class="viewer-action viewer-delete" data-action="delete">Delete</button>
      </div>
    `;
  }

  // Warm the browser cache for the adjacent previews so next/prev feels instant.
  function prefetchNeighbors(): void {
    for (const n of [index - 1, index + 1]) {
      const neighbor = items[n];
      if (neighbor && neighbor.mediaType === "photo") {
        const img = new Image();
        img.src = previewUrl(neighbor.id);
      }
    }
  }

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
  }

  function go(delta: number): void {
    const next = index + delta;
    if (next < 0 || next >= items.length) return;
    index = next;
    render();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
  }

  // Opens the original in the OS's default app (Preview/QuickTime/…). The file is
  // already local, so nothing is downloaded — the server just hands the OS the path.
  async function openOriginal(): Promise<void> {
    const item = items[index];
    if (!item) return;
    try {
      await openMediaOriginal(item.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  // Soft-deletes the current item (restorable quarantine), removes it from the
  // viewer, and advances — or closes if it was the last one.
  async function deleteCurrent(): Promise<void> {
    const item = items[index];
    if (!item) return;
    if (!confirm(`Delete "${item.filename}"?\n\nIt moves to a restorable quarantine (not erased).`)) return;
    try {
      await deleteMedia(item.id);
      items.splice(index, 1); // also updates the caller's array; the grid refreshes on next load
      if (items.length === 0) {
        close();
        return;
      }
      if (index >= items.length) index = items.length - 1;
      render();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  overlay.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).dataset.action;
    if (action === "close") close();
    else if (action === "prev") go(-1);
    else if (action === "next") go(1);
    else if (action === "open-original") void openOriginal();
    else if (action === "delete") void deleteCurrent();
  });

  document.addEventListener("keydown", onKeyDown);
  render();
}

function escapeAttr(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
