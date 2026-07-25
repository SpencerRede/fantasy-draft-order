import type { Horse } from "../shared/protocol";
import { resizeImageFile } from "./image-resize";

export type LaneStatus = "yours" | "filled" | "claimed" | "open";

// Images the local player has selected, keyed by lane. Populated on file
// selection (resized to a data URL) so the choice survives lobby re-renders —
// a <input type="file"> cannot be repopulated programmatically, so we must not
// depend on it still holding the file at submit time.
const pendingImages = new Map<number, string>();

export function laneStatus(horse: Horse, youId: string, _hostId: string | null): LaneStatus {
  if (horse.claimedBy === youId) return "yours";
  if (horse.filled) return "filled";
  if (horse.claimedBy) return "claimed";
  return "open";
}

// Reconcile key for a lane card: captures everything the server controls that
// affects how the card renders. A card is only rebuilt when this changes, so a
// card the player is mid-edit (unchanged server state) keeps its typed text,
// selected file, and focus instead of being destroyed on every broadcast.
export function laneSignature(horse: Horse, youId: string): string {
  return JSON.stringify({
    mine: horse.claimedBy === youId,
    claimed: !!horse.claimedBy,
    filled: horse.filled,
    horseName: horse.horseName,
    personName: horse.personName,
    hasImage: !!horse.image,
  });
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
  // Build the shell once; subsequent calls reconcile in place so in-progress
  // form input is never destroyed by an unrelated broadcast.
  let lobby = el.querySelector<HTMLDivElement>(".lobby");
  if (!lobby) {
    el.innerHTML = `
      <div class="lobby">
        <header class="lobby__header">
          <h1>Room <span class="lobby__code"></span></h1>
          <p class="lobby__hint">Share the code. Claim a lane, name your horse, add an image.</p>
        </header>
        <div class="lobby__grid" id="grid"></div>
        <div class="lobby__actions" id="actions"></div>
      </div>`;
    lobby = el.querySelector<HTMLDivElement>(".lobby")!;
  }

  lobby.querySelector<HTMLSpanElement>(".lobby__code")!.textContent = h.code;

  const grid = lobby.querySelector<HTMLDivElement>("#grid")!;
  for (const horse of h.lanes) {
    const sig = laneSignature(horse, h.youId);
    const existing = grid.querySelector<HTMLElement>(`[data-lane="${horse.lane}"]`);
    // Unchanged server state → leave the card (and its in-progress input) alone.
    if (existing && existing.dataset.sig === sig) continue;
    const card = buildLaneCard(horse, h);
    card.dataset.lane = String(horse.lane);
    card.dataset.sig = sig;
    if (existing) existing.replaceWith(card);
    else grid.appendChild(card);
  }

  const actions = lobby.querySelector<HTMLDivElement>("#actions")!;
  const isHost = h.youId === h.hostId;
  const allFilled = h.lanes.every((l) => l.filled);
  actions.innerHTML = "";
  if (isHost) {
    const start = document.createElement("button");
    start.className = "btn btn--primary";
    start.textContent = allFilled ? "Start Race" : "Waiting for all 12 lanes…";
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
    const currentImage = pendingImages.get(horse.lane) ?? horse.image;
    card.innerHTML = `<span class="lane-card__num">Lane ${horse.lane + 1} — yours</span>`;
    const form = document.createElement("form");
    form.className = "lane-form";
    form.innerHTML = `
      <input class="input" name="horse" placeholder="Horse name" value="${escapeAttr(horse.horseName)}" required />
      <input class="input" name="person" placeholder="Your name" value="${escapeAttr(horse.personName)}" required />
      <div class="lane-form__image">
        <img class="lane-form__thumb" alt="" ${currentImage ? `src="${escapeAttr(currentImage)}"` : "hidden"} />
        <input class="input" name="image" type="file" accept="image/*" />
      </div>
      <div class="lane-form__row">
        <button class="btn btn--primary" type="submit">${horse.filled ? "Update" : "Save"}</button>
        <button class="btn" type="button" data-release>Release</button>
      </div>
      <p class="lane-form__err" hidden></p>`;

    const err = form.querySelector<HTMLParagraphElement>(".lane-form__err")!;
    const thumb = form.querySelector<HTMLImageElement>(".lane-form__thumb")!;
    const fileInput = form.querySelector<HTMLInputElement>('input[name="image"]')!;

    // Resize and stash the image the moment it is chosen, so it persists even
    // if this card is later rebuilt by a broadcast.
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await resizeImageFile(file);
        pendingImages.set(horse.lane, dataUrl);
        thumb.src = dataUrl;
        thumb.hidden = false;
        err.hidden = true;
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex instanceof Error ? ex.message : "Could not read image";
      }
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      const data = new FormData(form);
      // Read the persisted image, never the transient file input.
      const image = pendingImages.get(horse.lane) ?? horse.image;
      if (!image) {
        err.hidden = false;
        err.textContent = "An image is required";
        return;
      }
      h.onSubmit(horse.lane, String(data.get("horse")), String(data.get("person")), image);
    };

    form.querySelector<HTMLButtonElement>("[data-release]")!.onclick = () => {
      pendingImages.delete(horse.lane);
      h.onRelease(horse.lane);
    };
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
