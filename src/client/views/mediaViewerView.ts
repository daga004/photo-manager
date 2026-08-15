import Panzoom, { type PanzoomObject } from "@panzoom/panzoom";
import { deleteMedia, openMediaOriginal } from "../api.ts";
import type { DayItem } from "../../shared/types.ts";

const thumbUrl = (id: number) => `/api/media/${id}/thumbnail`;
const previewUrl = (id: number) => `/api/media/${id}/preview`;
const originalUrl = (id: number) => `/api/media/${id}/full`;

/** Identifies the "collection" currently open in the viewer — a day (key = date)
 * or a duplicate group (key = content hash). `label` is shown in the footer. */
export interface ViewerContext {
  key: string;
  label?: string;
}

export interface ViewerOptions {
  /** Request true OS fullscreen for the overlay (needs a user gesture, e.g. a double-click). */
  fullscreen?: boolean;
  /** The collection these items belong to — enables Up/Down navigation between collections. */
  context?: ViewerContext;
  /** Loads the previous/next collection's items (Up = "prev", Down = "next").
   * Returns null when there's no adjacent collection. */
  onRequestAdjacent?: (
    currentKey: string,
    direction: "prev" | "next",
  ) => Promise<{ context: ViewerContext; items: DayItem[] } | null>;
  /** Called when the viewer closes, with the collection key it ended on — lets the
   * caller re-sync (e.g. navigate to the last-viewed day). */
  onClose?: (finalKey: string | undefined) => void;
  /** Noun for the collection in the on-screen key hints: "day" (day view) or
   * "group" (duplicates). Defaults to "collection". */
  collectionNoun?: string;
}

/**
 * Reusable fullscreen media viewer, shared by the day and duplicates views.
 * Keyboard:
 *   ← / →   previous / next item within the current collection
 *   ↑ / ↓   previous / next collection (day or duplicate group), when provided
 *   Delete  soft-delete the current file
 *   Esc     close
 */
export function openMediaViewer(items: DayItem[], startIndex: number, opts: ViewerOptions = {}): void {
  let list = items;
  let index = startIndex;
  let currentContext = opts.context;
  let infoVisible = false; // immersive by default; Space reveals name + instructions
  let hintDismissed = false; // the "Press Space for info" hint auto-hides after 5s
  const noun = opts.collectionNoun ?? "collection";
  let pz: PanzoomObject | null = null; // pan/zoom on the current photo (recreated per image)

  const overlay = document.createElement("div");
  overlay.className = "media-viewer-overlay";
  document.body.appendChild(overlay);

  // Trackpad gestures: pinch (ctrl+wheel) zooms toward the cursor; two-finger
  // scroll pans when zoomed in, or zooms when the image is at fit. Mouse wheel
  // zooms too. Bound to the media container each render (the element is rebuilt).
  function onWheel(e: WheelEvent): void {
    if (!pz) return;
    e.preventDefault();
    if (e.ctrlKey) {
      pz.zoomWithWheel(e);
    } else if (pz.getScale() > 1) {
      const p = pz.getPan();
      pz.pan(p.x - e.deltaX, p.y - e.deltaY, { animate: false });
    } else {
      pz.zoomWithWheel(e);
    }
  }

  if (opts.fullscreen) {
    // Real fullscreen fills the whole display; if blocked, the overlay already
    // covers the viewport, so it degrades gracefully.
    overlay.requestFullscreen?.().catch(() => {});
  }

  function render(): void {
    const item = list[index];
    if (!item) return;

    // Tear down the previous image's pan/zoom so each image starts at fit.
    pz?.destroy();
    pz = null;

    if (item.mediaType === "video") {
      renderShell(`<video src="${originalUrl(item.id)}" controls autoplay></video>`, item);
    } else {
      renderShell(
        `<img class="viewer-img viewer-img-loading" decoding="async" src="${thumbUrl(item.id)}" alt="${escapeAttr(item.filename)}" />`,
        item,
      );
      const imgEl = overlay.querySelector<HTMLImageElement>(".viewer-img");
      if (imgEl) {
        const full = new Image();
        full.onload = () => {
          if (list[index]?.id === item.id) {
            imgEl.src = full.src;
            imgEl.classList.remove("viewer-img-loading");
          }
        };
        full.src = previewUrl(item.id);

        // Pan/zoom on the photo. panOnlyWhenZoomed keeps a plain click/drag at fit
        // from moving the image (so background-click-to-close still works, and
        // arrow/keyboard nav is unaffected). Wheel handling is custom (see onWheel).
        pz = Panzoom(imgEl, { maxScale: 8, minScale: 1, panOnlyWhenZoomed: true, cursor: "grab" });
        overlay.querySelector<HTMLElement>(".viewer-media")?.addEventListener("wheel", onWheel, { passive: false });
      }
    }

    prefetchNeighbors();
  }

  function renderShell(mediaHtml: string, item: DayItem): void {
    const label = currentContext?.label ? `${escapeAttr(currentContext.label)} &middot; ` : "";
    overlay.innerHTML = `
      <button class="viewer-close" data-action="close" aria-label="Close">&times;</button>
      <button class="viewer-prev" data-action="prev" ${index === 0 ? "disabled" : ""} aria-label="Previous">&larr;</button>
      <div class="viewer-media">${mediaHtml}</div>
      <button class="viewer-next" data-action="next" ${index === list.length - 1 ? "disabled" : ""} aria-label="Next">&rarr;</button>
      ${hintDismissed ? "" : `<div class="viewer-hint">Press <kbd>Space</kbd> for info</div>`}
      <div class="viewer-info">
        <div class="viewer-info-name">${label}${escapeAttr(item.filename)}</div>
        <div class="viewer-info-pos">${index + 1} / ${list.length}</div>
        <div class="viewer-info-actions">
          <button class="viewer-action" data-action="open-original">Open original</button>
          <button class="viewer-action viewer-delete" data-action="delete">Delete</button>
        </div>
        <ul class="viewer-info-keys">
          <li><kbd>&larr;</kbd> <kbd>&rarr;</kbd> browse within this ${escapeAttr(noun)}</li>
          <li><kbd>&uarr;</kbd> <kbd>&darr;</kbd> previous / next ${escapeAttr(noun)}</li>
          <li><kbd>Delete</kbd> delete &middot; <kbd>Enter</kbd> open in file manager &middot; <kbd>Esc</kbd> close</li>
          <li>Pinch or scroll to zoom &middot; drag to pan</li>
        </ul>
      </div>
    `;
    overlay.classList.toggle("show-info", infoVisible);
  }

  // Warm the browser cache for the adjacent previews so next/prev feels instant.
  function prefetchNeighbors(): void {
    for (const n of [index - 1, index + 1]) {
      const neighbor = list[n];
      if (neighbor && neighbor.mediaType === "photo") {
        const img = new Image();
        img.src = previewUrl(neighbor.id);
      }
    }
  }

  // Opens the original in the OS's default app; the file is local, so nothing downloads.
  async function openOriginal(): Promise<void> {
    const item = list[index];
    if (!item) return;
    try {
      await openMediaOriginal(item.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  // Soft-deletes the current item (restorable quarantine), removes it, and advances.
  async function deleteCurrent(): Promise<void> {
    const item = list[index];
    if (!item) return;
    if (!confirm(`Delete "${item.filename}"?\n\nIt moves to a restorable quarantine (not erased).`)) return;
    try {
      await deleteMedia(item.id);
      list.splice(index, 1); // mutates the caller's array too; the view refreshes on next load
      if (list.length === 0) {
        close();
        return;
      }
      if (index >= list.length) index = list.length - 1;
      render();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  // Loads the previous/next collection's items into the viewer in place.
  async function changeCollection(direction: "prev" | "next"): Promise<void> {
    if (!opts.onRequestAdjacent || !currentContext) return;
    try {
      const res = await opts.onRequestAdjacent(currentContext.key, direction);
      if (!res || res.items.length === 0) return;
      list = res.items;
      currentContext = res.context;
      index = 0;
      render();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  function close(): void {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    pz?.destroy();
    pz = null;
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
    opts.onClose?.(currentContext?.key);
  }

  function go(delta: number): void {
    const next = index + delta;
    if (next < 0 || next >= list.length) return;
    index = next;
    render();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      void changeCollection("prev");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      void changeCollection("next");
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      void deleteCurrent();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void openOriginal();
    } else if (e.key === " " || e.code === "Space") {
      e.preventDefault(); // don't scroll the page behind
      infoVisible = !infoVisible;
      overlay.classList.toggle("show-info", infoVisible);
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

  // Fade the "Press Space for info" hint out after 5s, then stop rendering it so
  // it doesn't reappear as the user navigates between images.
  setTimeout(() => {
    hintDismissed = true;
    overlay.querySelector<HTMLElement>(".viewer-hint")?.classList.add("viewer-hint-hidden");
  }, 5000);
}

function escapeAttr(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
