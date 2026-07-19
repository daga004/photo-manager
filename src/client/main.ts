import { renderDayList } from "./views/dayListView.ts";
import { renderDayDetail } from "./views/dayDetailView.ts";
import { renderDuplicates } from "./views/duplicatesView.ts";
import { renderImport } from "./views/importView.ts";
import { renderReindex } from "./views/reindexView.ts";

const app = document.getElementById("app");

function navigate(path: string): void {
  if (location.hash === path) {
    void route();
  } else {
    location.hash = path;
  }
}

function setActiveNav(section: string): void {
  document.querySelectorAll<HTMLElement>("nav a[data-nav]").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === section);
  });
}

async function route(): Promise<void> {
  if (!app) return;
  const hash = location.hash || "#/days";
  const match = hash.match(/^#\/(\w+)(?:\/(.+))?$/);
  const path = match?.[1];
  const param = match?.[2];

  try {
    if (path === "days" && param) {
      setActiveNav("days");
      await renderDayDetail(app, decodeURIComponent(param));
    } else if (path === "days") {
      setActiveNav("days");
      await renderDayList(app, navigate);
    } else if (path === "duplicates") {
      setActiveNav("duplicates");
      await renderDuplicates(app);
    } else if (path === "import") {
      setActiveNav("import");
      await renderImport(app);
    } else if (path === "reindex") {
      setActiveNav("reindex");
      await renderReindex(app);
    } else {
      setActiveNav("days");
      await renderDayList(app, navigate);
    }
  } catch (err) {
    app.innerHTML = `<p class="error-state">${err instanceof Error ? err.message : String(err)}</p>`;
  }
}

window.addEventListener("hashchange", () => void route());
void route();
