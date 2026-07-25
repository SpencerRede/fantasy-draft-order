import type { Horse } from "../shared/protocol";
import { resizeImageFile } from "./image-resize";

export type LaneStatus = "yours" | "filled" | "claimed" | "open";

export function laneStatus(horse: Horse, youId: string, _hostId: string | null): LaneStatus {
  if (horse.claimedBy === youId) return "yours";
  if (horse.filled) return "filled";
  if (horse.claimedBy) return "claimed";
  return "open";
}

export function renderLanding(
  el: HTMLElement,
  handlers: { onCreate: () => void; onJoin: (code: string) => void }
): void {
  el.innerHTML = `
    <div class="landing">
      <h1 class="landing__title">🏇 Draft Order Race</h1>
      <button class="btn btn--primary" id="create">Create a Room</button>
      <div class="landing__join">
        <input id="code" class="input" maxlength="8" placeholder="ROOM CODE" />
        <button class="btn" id="join">Join</button>
      </div>
    </div>`;
  el.querySelector<HTMLButtonElement>("#create")!.onclick = () => handlers.onCreate();
  el.querySelector<HTMLButtonElement>("#join")!.onclick = () => {
    const code = el.querySelector<HTMLInputElement>("#code")!.value.trim().toUpperCase();
    if (code) handlers.onJoin(code);
  };
}

export interface LobbyHandlers {
  lanes: Horse[];
  youId: string;
  hostId: string | null;
  code: string;
  onClaim: (lane: number) => void;
  onSubmit: (lane: number, horseName: string, personName: string, image: string) => void;
  onRelease: (lane: number) => void;
  onStart: () => void;
}

export function renderLobby(el: HTMLElement, h: LobbyHandlers): void {
  const allFilled = h.lanes.every((l) => l.filled);
  const isHost = h.youId === h.hostId;

  el.innerHTML = `
    <div class="lobby">
      <header class="lobby__header">
        <h1>Room <span class="lobby__code">${escapeHtml(h.code)}</span></h1>
        <p class="lobby__hint">Share the code. Claim a lane, name your horse, add an image.</p>
      </header>
      <div class="lobby__grid" id="grid"></div>
      <div class="lobby__actions" id="actions"></div>
    </div>`;

  const grid = el.querySelector<HTMLDivElement>("#grid")!;
  for (const horse of h.lanes) {
    grid.appendChild(buildLaneCard(horse, h));
  }

  const actions = el.querySelector<HTMLDivElement>("#actions")!;
  if (isHost) {
    const start = document.createElement("button");
    start.className = "btn btn--primary";
    start.textContent = allFilled ? "Start Race" : `Waiting for all 12 lanes…`;
    start.disabled = !allFilled;
    start.onclick = () => h.onStart();
    actions.appendChild(start);
  } else {
    actions.innerHTML = `<p class="lobby__hint">Waiting for the host to start…</p>`;
  }
}

function buildLaneCard(horse: Horse, h: LobbyHandlers): HTMLElement {
  const status = laneStatus(horse, h.youId, h.hostId);
  const card = document.createElement("div");
  card.className = `lane-card lane-card--${status}`;

  if (status === "open") {
    card.innerHTML = `<span class="lane-card__num">Lane ${horse.lane + 1}</span>`;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Claim";
    btn.onclick = () => h.onClaim(horse.lane);
    card.appendChild(btn);
    return card;
  }

  if (status === "yours") {
    card.innerHTML = `<span class="lane-card__num">Lane ${horse.lane + 1} — yours</span>`;
    const form = document.createElement("form");
    form.className = "lane-form";
    form.innerHTML = `
      <input class="input" name="horse" placeholder="Horse name" value="${escapeAttr(horse.horseName)}" required />
      <input class="input" name="person" placeholder="Your name" value="${escapeAttr(horse.personName)}" required />
      <input class="input" name="image" type="file" accept="image/*" ${horse.filled ? "" : "required"} />
      <div class="lane-form__row">
        <button class="btn btn--primary" type="submit">${horse.filled ? "Update" : "Save"}</button>
        <button class="btn" type="button" data-release>Release</button>
      </div>
      <p class="lane-form__err" hidden></p>`;
    const err = form.querySelector<HTMLParagraphElement>(".lane-form__err")!;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const file = data.get("image") as File | null;
      try {
        const image = file && file.size
          ? await resizeImageFile(file)
          : horse.image; // keep existing image on update
        if (!image) throw new Error("An image is required");
        h.onSubmit(horse.lane, String(data.get("horse")), String(data.get("person")), image);
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex instanceof Error ? ex.message : "Something went wrong";
      }
    };
    form.querySelector<HTMLButtonElement>("[data-release]")!.onclick = () => h.onRelease(horse.lane);
    card.appendChild(form);
    return card;
  }

  // claimed by other / filled by other
  card.innerHTML = `
    <span class="lane-card__num">Lane ${horse.lane + 1}</span>
    ${horse.filled && horse.image ? `<img class="lane-card__img" src="${escapeHtml(horse.image)}" alt="" />` : ""}
    <span class="lane-card__status">${horse.filled ? escapeHtml(horse.horseName) : "Claimed…"}</span>`;
  return card;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
