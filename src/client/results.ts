import type { Horse } from "../shared/protocol";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function generateRoomCode(): string {
  // globalThis.crypto is the Web Crypto API — present in browsers and Node 18+.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function standings(
  lanes: Horse[],
  finishOrder: number[]
): { rank: number; horse: Horse }[] {
  return finishOrder.map((lane, i) => ({ rank: i + 1, horse: lanes[lane] }));
}

export function renderResults(
  el: HTMLElement,
  lanes: Horse[],
  finishedLanes: number[],
  finishOrder: number[]
): void {
  // Only show lanes that have finished so far, in finishOrder sequence.
  const finishedSet = new Set(finishedLanes);
  const visibleOrder = finishOrder.filter((lane) => finishedSet.has(lane));
  const rows = standings(lanes, visibleOrder);

  el.innerHTML = `<h2 class="results__title">Draft Order</h2>`;
  const list = document.createElement("ol");
  list.className = "results__list";
  for (const { rank, horse } of rows) {
    const li = document.createElement("li");
    li.className = "results__row";
    li.innerHTML = `
      <span class="results__rank">${rank}</span>
      ${horse.image ? `<img class="results__img" src="${escapeHtml(horse.image)}" alt="" />` : ""}
      <span class="results__names">
        <span class="results__horse">${escapeHtml(horse.horseName)}</span>
        <span class="results__person">${escapeHtml(horse.personName)}</span>
      </span>`;
    list.appendChild(li);
  }
  el.appendChild(list);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}
