import type { DayAggregate } from "../../shared/types.ts";

/** Purely client-side against the already-fetched days array — typing a full
 * YYYY-MM-DD jumps to that day (or the nearest one), YYYY-MM or YYYY jumps to
 * the first matching day, no server round-trip needed. */
export function renderQuickJump(container: HTMLElement, days: DayAggregate[], onJump: (date: string) => void): void {
  container.innerHTML = `<input type="text" id="quick-jump-input" placeholder="Jump to date (YYYY, YYYY-MM, or YYYY-MM-DD)" />`;
  const input = container.querySelector<HTMLInputElement>("#quick-jump-input");
  if (!input) return;

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const query = input.value.trim();
    if (!query) return;
    const exact = days.find((d) => d.date === query);
    const prefixMatch = days.find((d) => d.date.startsWith(query));
    const match = exact ?? prefixMatch;
    if (match) onJump(match.date);
  });
}
