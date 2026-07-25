import { RoomConnection } from "./ws-client";
import { renderLanding, renderLobby } from "./lobby";
import { RaceCanvas } from "./race-canvas";
import { runCountdown } from "./countdown";
import { renderResults, generateRoomCode } from "./results";
import type { Horse, RaceScript, ServerMessage } from "../shared/protocol";

const app = document.querySelector<HTMLDivElement>("#app")!;

interface State {
  code: string;
  conn: RoomConnection | null;
  youId: string;
  hostId: string | null;
  status: "landing" | "lobby" | "countdown" | "racing" | "finished";
  lanes: Horse[];
  script: RaceScript | null;
  finishedLanes: number[];
}

const state: State = {
  code: "",
  conn: null,
  youId: "",
  hostId: null,
  status: "landing",
  lanes: [],
  script: null,
  finishedLanes: [],
};

let raceCanvas: RaceCanvas | null = null;

function connect(code: string): void {
  state.code = code;
  state.conn = new RoomConnection(code, { onMessage: handleMessage });
  history.replaceState(null, "", `#${code}`);
}

function handleMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case "room_state":
      state.youId = msg.youId;
      state.hostId = msg.hostId;
      state.lanes = msg.lanes;
      if (state.status === "landing" || state.status === "lobby") {
        state.status = "lobby";
        render();
      }
      break;
    case "race_start":
      state.script = msg.script;
      state.status = "countdown";
      renderRace(msg.startAt);
      break;
    case "error":
      // Non-fatal; surface briefly.
      console.warn(msg.message);
      flashError(msg.message);
      break;
  }
}

function render(): void {
  if (state.status === "landing") {
    renderLanding(app, {
      onCreate: () => connect(generateRoomCode()),
      onJoin: (code) => connect(code),
    });
    return;
  }
  if (state.status === "lobby") {
    renderLobby(app, {
      lanes: state.lanes,
      youId: state.youId,
      hostId: state.hostId,
      code: state.code,
      onClaim: (lane) => state.conn!.send({ type: "claim_lane", lane }),
      onSubmit: (lane, horseName, personName, image) =>
        state.conn!.send({ type: "submit_horse", lane, horseName, personName, image }),
      onRelease: (lane) => state.conn!.send({ type: "release_lane", lane }),
      onStart: () => state.conn!.send({ type: "start_race" }),
    });
  }
}

function renderRace(startAt: number): void {
  app.innerHTML = `
    <div class="race-screen">
      <div class="race-screen__track">
        <canvas id="canvas"></canvas>
        <div class="countdown" id="countdown"></div>
      </div>
      <aside class="race-screen__results" id="results"></aside>
    </div>`;

  const canvas = app.querySelector<HTMLCanvasElement>("#canvas")!;
  const results = app.querySelector<HTMLElement>("#results")!;
  const countdownEl = app.querySelector<HTMLElement>("#countdown")!;

  sizeCanvas(canvas);
  window.addEventListener("resize", () => sizeCanvas(canvas));

  // Initial results panel: lobby standings placeholder.
  renderResults(results, state.lanes, [], state.script!.finishOrder);

  raceCanvas = new RaceCanvas(canvas, state.lanes);
  raceCanvas.onFinishedChange((finished) => {
    state.finishedLanes = finished;
    renderResults(results, state.lanes, finished, state.script!.finishOrder);
  });
  raceCanvas.onDone(() => {
    state.status = "finished";
    renderResults(results, state.lanes, state.script!.finishOrder, state.script!.finishOrder);
  });

  runCountdown(countdownEl, startAt, () => {
    state.status = "racing";
    raceCanvas!.start(state.script!, startAt);
  });
}

function sizeCanvas(canvas: HTMLCanvasElement): void {
  const rect = canvas.parentElement!.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

function flashError(message: string): void {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// Deep link support: #CODE joins directly.
const hash = location.hash.replace("#", "").toUpperCase();
if (hash) connect(hash);
render();
