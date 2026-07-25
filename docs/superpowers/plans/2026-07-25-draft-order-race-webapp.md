# Draft Order Race Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Tkinter `DraftOrderRace.py` as a real-time multiplayer web app on Cloudflare (Workers + Static Assets + one Durable Object) where people join a room, each names/images a horse, and the host starts a synchronized race whose finish order is the fantasy draft order.

**Architecture:** A single Cloudflare Workers project serves a vanilla-TypeScript + Canvas SPA and hosts one `RaceRoom` Durable Object per room. Room code lives in the WebSocket URL (`/ws?code=XXXX`); the first connection becomes host. On Start the DO runs the *entire* race simulation deterministically and broadcasts a race script + finish order; every browser animates that same script in lockstep. Images are resized client-side to ~64px data URLs and kept only in live room state — no storage backend.

**Tech Stack:** TypeScript, Vite (client bundling), Cloudflare Workers + Static Assets, Durable Objects, Wrangler, Vitest, `@cloudflare/vitest-pool-workers` (DO integration tests), HTML5 Canvas.

## Global Constraints

- Language: TypeScript everywhere; no runtime UI framework (vanilla DOM + Canvas).
- `LANE_COUNT = 12`, `TRACK_LENGTH_UNITS = 1270`.
- Roll each round = `randInt(5,10) * 2` → one of {10,12,14,16,18,20}; dust flair when roll > 15.
- `TICKS_PER_ROUND = 5`. Race outcome is computed authoritatively on the server; clients only animate the broadcast script.
- Images: resized client-side to max 64px, sent as data URLs over WebSocket; never persisted to storage.
- Only the host (first connection) may start; Start requires all 12 lanes filled.
- Deploy is a single `wrangler deploy`; build is `npm run build`.
- Node 20+. Package manager: npm. All commits use Conventional Commit prefixes.
- Shared code (`src/shared/`) must import nothing from `src/client/` or `src/server/`.

---

## File Structure

```
package.json                    scripts, deps
tsconfig.json                   TS config (shared)
vite.config.ts                  client build → dist/
vitest.config.ts                node-env tests (pure logic)
vitest.workers.config.ts        workers-pool tests (Durable Object)
wrangler.toml                   Worker + assets + DO binding/migration
index.html                      SPA shell
.github/workflows/deploy.yml    CI deploy
README.md                       build/deploy/run docs

src/shared/
  constants.ts                  all tunable constants
  protocol.ts                   Horse, RoomStatus, RaceScript, Client/ServerMessage
  rng.ts                        seeded RNG (mulberry32) + rollFor
  race-sim.ts                   simulate(seed) → RaceScript (pure)
  room-state.ts                 RoomState + pure reducers (claim/submit/etc.)

src/server/
  index.ts                      Worker entry: route /ws → DO, else static assets
  room.ts                       RaceRoom Durable Object (WS hibernation + broadcast)

src/client/
  main.ts                       app orchestrator / screen state machine
  ws-client.ts                  typed WebSocket wrapper + message parsing
  image-resize.ts               file → resized data URL (+ pure size math)
  race-anim.ts                  computeRaceFrame(script, elapsedMs) (pure)
  race-canvas.ts                Canvas renderer (uses race-anim)
  lobby.ts                      landing + lane grid + claim/submit + Start
  results.ts                    live standings panel
  countdown.ts                  3-2-1 overlay
  styles.css                    layout (3/4 race, 1/4 results)

tests/                          mirrors src for pure-logic tests
```

---

### Task 1: Project scaffolding, tooling, and a served "hello" Worker

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `wrangler.toml`, `index.html`, `.gitignore`
- Create: `src/server/index.ts`, `src/shared/constants.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `constants.ts` exports used everywhere; a Worker that serves `dist/` static assets and returns `426` for `/ws` (placeholder until Task 6).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "draft-order-race",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "wrangler dev",
    "dev:client": "vite",
    "deploy": "npm run build && wrangler deploy",
    "test": "vitest run --config vitest.config.ts",
    "test:workers": "vitest run --config vitest.workers.config.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240000.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.80.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["@cloudflare/workers-types", "vite/client"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src", "tests", "*.config.ts"]
}
```

- [ ] **Step 3: Create `vite.config.ts`** (client bundles into `dist/`)

```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 4: Create `vitest.config.ts`** (node env for pure logic)

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/workers/**"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Create `src/shared/constants.ts`**

```ts
export const LANE_COUNT = 12;
export const TRACK_LENGTH_UNITS = 1270;
export const TICKS_PER_ROUND = 5;

// Roll = randInt(ROLL_MIN, ROLL_MAX) * 2  →  {10,12,14,16,18,20}
export const ROLL_MIN = 5;
export const ROLL_MAX = 10;
export const DUST_THRESHOLD = 15; // roll > this spawns dust

// Animation timing (client only; tuned for ~30-45s race).
export const TICK_MS = 60;
export const ROUND_PAUSE_MS = 120;
export const COUNTDOWN_MS = 3500; // 3..2..1..go overlay window

// Image thumbnail max dimension (px).
export const THUMB_MAX_PX = 64;
```

- [ ] **Step 6: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Draft Order Race</title>
    <link rel="stylesheet" href="/src/client/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/client/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: Create placeholder `src/client/main.ts` and `src/client/styles.css`** (so the client build succeeds)

`src/client/main.ts`:
```ts
document.querySelector<HTMLDivElement>("#app")!.textContent = "Draft Order Race";
```

`src/client/styles.css`:
```css
body { margin: 0; font-family: system-ui, sans-serif; background: #0b0b0b; color: #fff; }
```

- [ ] **Step 8: Create `src/server/index.ts`** (serves assets; `/ws` placeholder)

```ts
export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      return new Response("WebSocket endpoint not wired yet", { status: 426 });
    }
    return env.ASSETS.fetch(request);
  },
};
```

- [ ] **Step 9: Create `wrangler.toml`** (DO binding added in Task 6; assets + main now)

```toml
name = "draft-order-race"
main = "src/server/index.ts"
compatibility_date = "2024-09-23"

[assets]
directory = "./dist"
binding = "ASSETS"
```

- [ ] **Step 10: Create `.gitignore`**

```
node_modules/
dist/
.wrangler/
```

- [ ] **Step 11: Install and verify build + typecheck**

Run: `npm install && npm run build && npm run typecheck`
Expected: install succeeds; `dist/index.html` produced; typecheck exits 0.

- [ ] **Step 12: Commit**

```bash
git add package.json tsconfig.json vite.config.ts vitest.config.ts wrangler.toml index.html .gitignore src/
git commit -m "chore: scaffold Workers + Vite + Vitest project"
```

---

### Task 2: Shared protocol types

**Files:**
- Create: `src/shared/protocol.ts`
- Test: `tests/protocol.test.ts`

**Interfaces:**
- Consumes: `LANE_COUNT` from `constants.ts`.
- Produces: `Horse`, `RoomStatus`, `RaceScript`, `ClientMessage`, `ServerMessage`, and `emptyLanes()`.

- [ ] **Step 1: Write the failing test** — `tests/protocol.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { emptyLanes } from "../src/shared/protocol";
import { LANE_COUNT } from "../src/shared/constants";

describe("emptyLanes", () => {
  it("creates one unclaimed, unfilled lane per index", () => {
    const lanes = emptyLanes();
    expect(lanes).toHaveLength(LANE_COUNT);
    lanes.forEach((lane, i) => {
      expect(lane.lane).toBe(i);
      expect(lane.claimedBy).toBeNull();
      expect(lane.filled).toBe(false);
      expect(lane.image).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/protocol.test.ts`
Expected: FAIL — cannot find module `protocol` / `emptyLanes` not exported.

- [ ] **Step 3: Create `src/shared/protocol.ts`**

```ts
import { LANE_COUNT } from "./constants";

export interface Horse {
  lane: number;              // 0..LANE_COUNT-1
  claimedBy: string | null;  // connection id, or null if unclaimed
  horseName: string;
  personName: string;
  image: string | null;      // data URL thumbnail, or null
  filled: boolean;           // true once submitted with name+person+image
}

export type RoomStatus = "lobby" | "racing" | "finished";

export interface RaceScript {
  // rounds[roundIndex][lane] = roll applied that round (0 if already finished)
  rounds: number[][];
  // lane indices in finishing order, 1st .. last
  finishOrder: number[];
}

export type ClientMessage =
  | { type: "claim_lane"; lane: number }
  | { type: "submit_horse"; lane: number; horseName: string; personName: string; image: string }
  | { type: "release_lane"; lane: number }
  | { type: "start_race" };

export type ServerMessage =
  | { type: "room_state"; status: RoomStatus; hostId: string | null; youId: string; lanes: Horse[] }
  | { type: "race_start"; script: RaceScript; startAt: number }
  | { type: "error"; message: string };

export function emptyLanes(): Horse[] {
  return Array.from({ length: LANE_COUNT }, (_, i) => ({
    lane: i,
    claimedBy: null,
    horseName: "",
    personName: "",
    image: null,
    filled: false,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/protocol.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/protocol.ts tests/protocol.test.ts
git commit -m "feat: add shared protocol types"
```

---

### Task 3: Seeded RNG and roll function

**Files:**
- Create: `src/shared/rng.ts`
- Test: `tests/rng.test.ts`

**Interfaces:**
- Consumes: `ROLL_MIN`, `ROLL_MAX` from `constants.ts`.
- Produces: `makeRng(seed: number): () => number` (float in [0,1)); `rollFor(rng: () => number): number`.

- [ ] **Step 1: Write the failing test** — `tests/rng.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { makeRng, rollFor } from "../src/shared/rng";

describe("makeRng", () => {
  it("is deterministic for a given seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    seqA.forEach((n) => {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    });
  });
});

describe("rollFor", () => {
  it("only ever returns even values in {10,12,14,16,18,20}", () => {
    const rng = makeRng(7);
    const allowed = new Set([10, 12, 14, 16, 18, 20]);
    for (let i = 0; i < 5000; i++) {
      expect(allowed.has(rollFor(rng))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/rng.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/shared/rng.ts`**

```ts
import { ROLL_MIN, ROLL_MAX } from "./constants";

// mulberry32 — small, fast, deterministic PRNG.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mirrors Python randint(ROLL_MIN, ROLL_MAX) * 2 (inclusive on both ends).
export function rollFor(rng: () => number): number {
  const span = ROLL_MAX - ROLL_MIN + 1; // inclusive
  const half = ROLL_MIN + Math.floor(rng() * span);
  return half * 2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/rng.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/rng.ts tests/rng.test.ts
git commit -m "feat: add seeded RNG and roll function"
```

---

### Task 4: Race simulation

**Files:**
- Create: `src/shared/race-sim.ts`
- Test: `tests/race-sim.test.ts`

**Interfaces:**
- Consumes: `makeRng`, `rollFor` (rng.ts); `LANE_COUNT`, `TRACK_LENGTH_UNITS` (constants.ts); `RaceScript` (protocol.ts).
- Produces: `simulate(seed: number, laneCount?: number): RaceScript`.

Simulation rules (ported from `DraftOrderRace.py`): each round, every un-finished lane rolls and advances by that roll. Lanes that reach `TRACK_LENGTH_UNITS` this round finish; within a round they are ordered by **larger overshoot first, then lower lane index**, and appended to `finishOrder`. Loop until all lanes finished.

- [ ] **Step 1: Write the failing test** — `tests/race-sim.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { simulate } from "../src/shared/race-sim";
import { LANE_COUNT, TRACK_LENGTH_UNITS } from "../src/shared/constants";

describe("simulate", () => {
  it("is deterministic for a seed", () => {
    expect(simulate(123)).toEqual(simulate(123));
  });

  it("finishes every lane exactly once", () => {
    const { finishOrder } = simulate(999);
    expect(finishOrder).toHaveLength(LANE_COUNT);
    expect(new Set(finishOrder).size).toBe(LANE_COUNT);
    finishOrder.forEach((lane) => {
      expect(lane).toBeGreaterThanOrEqual(0);
      expect(lane).toBeLessThan(LANE_COUNT);
    });
  });

  it("rounds have one entry per lane and finished lanes roll 0", () => {
    const { rounds } = simulate(55);
    for (const round of rounds) {
      expect(round).toHaveLength(LANE_COUNT);
    }
    // Cumulative per-lane totals must each reach the track length.
    const totals = new Array(LANE_COUNT).fill(0);
    for (const round of rounds) {
      round.forEach((roll, lane) => (totals[lane] += roll));
    }
    totals.forEach((t) => expect(t).toBeGreaterThanOrEqual(TRACK_LENGTH_UNITS));
  });

  it("tie-breaks a same-round finish by larger overshoot then lower lane", () => {
    // Hand-built script: lanes 0 and 1 both cross on the final round.
    // Lane 1 overshoots more, so it must rank ahead of lane 0.
    const { finishOrder } = simulate(0, 2);
    expect(new Set(finishOrder)).toEqual(new Set([0, 1]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/race-sim.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/shared/race-sim.ts`**

```ts
import { makeRng, rollFor } from "./rng";
import { LANE_COUNT, TRACK_LENGTH_UNITS } from "./constants";
import type { RaceScript } from "./protocol";

export function simulate(seed: number, laneCount = LANE_COUNT): RaceScript {
  const rng = makeRng(seed);
  const positions = new Array(laneCount).fill(0);
  const finished = new Array(laneCount).fill(false);
  const rounds: number[][] = [];
  const finishOrder: number[] = [];

  while (finishOrder.length < laneCount) {
    const round = new Array(laneCount).fill(0);
    const finishersThisRound: { lane: number; overshoot: number }[] = [];

    for (let lane = 0; lane < laneCount; lane++) {
      if (finished[lane]) continue;
      const roll = rollFor(rng);
      round[lane] = roll;
      positions[lane] += roll;
      if (positions[lane] >= TRACK_LENGTH_UNITS) {
        finished[lane] = true;
        finishersThisRound.push({
          lane,
          overshoot: positions[lane] - TRACK_LENGTH_UNITS,
        });
      }
    }

    finishersThisRound.sort(
      (a, b) => b.overshoot - a.overshoot || a.lane - b.lane
    );
    for (const f of finishersThisRound) finishOrder.push(f.lane);

    rounds.push(round);
  }

  return { rounds, finishOrder };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/race-sim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/race-sim.ts tests/race-sim.test.ts
git commit -m "feat: add deterministic race simulation"
```

---

### Task 5: Room state reducers (pure)

**Files:**
- Create: `src/shared/room-state.ts`
- Test: `tests/room-state.test.ts`

**Interfaces:**
- Consumes: `Horse`, `RoomStatus`, `emptyLanes` (protocol.ts).
- Produces:
  - `RoomState { status; hostId: string | null; connections: string[]; lanes: Horse[] }`
  - `initialRoomState(): RoomState`
  - `addConnection(s, id): RoomState`
  - `removeConnection(s, id): RoomState`
  - `claimLane(s, id, lane): { state: RoomState; error?: string }`
  - `submitHorse(s, id, lane, horseName, personName, image): { state: RoomState; error?: string }`
  - `releaseLane(s, id, lane): { state: RoomState; error?: string }`
  - `canStart(s, id): boolean`
  - `startRace(s, id): { state: RoomState; error?: string }`

All reducers are pure (return new state; never mutate input). Guards: claim fails if lane taken by someone else; submit fails unless caller is the lane's claimer; start fails unless caller is host, status is `lobby`, and all lanes filled. `removeConnection` reassigns host to the earliest remaining connection and releases that connection's *unfilled* claims (filled horses persist).

- [ ] **Step 1: Write the failing test** — `tests/room-state.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  initialRoomState,
  addConnection,
  removeConnection,
  claimLane,
  submitHorse,
  releaseLane,
  canStart,
  startRace,
} from "../src/shared/room-state";
import { LANE_COUNT } from "../src/shared/constants";

const fill = (s: ReturnType<typeof initialRoomState>, id: string, lane: number) => {
  s = claimLane(s, id, lane).state;
  return submitHorse(s, id, lane, `H${lane}`, `P${lane}`, "data:image/x").state;
};

describe("room-state", () => {
  it("first connection becomes host", () => {
    let s = initialRoomState();
    s = addConnection(s, "a");
    s = addConnection(s, "b");
    expect(s.hostId).toBe("a");
    expect(s.connections).toEqual(["a", "b"]);
  });

  it("claim then submit fills a lane owned by the claimer", () => {
    let s = addConnection(initialRoomState(), "a");
    s = claimLane(s, "a", 0).state;
    expect(s.lanes[0].claimedBy).toBe("a");
    s = submitHorse(s, "a", 0, "Seabiscuit", "Spencer", "data:image/x").state;
    expect(s.lanes[0].filled).toBe(true);
    expect(s.lanes[0].horseName).toBe("Seabiscuit");
  });

  it("rejects claiming a lane owned by someone else", () => {
    let s = addConnection(addConnection(initialRoomState(), "a"), "b");
    s = claimLane(s, "a", 0).state;
    const res = claimLane(s, "b", 0);
    expect(res.error).toBeTruthy();
    expect(res.state.lanes[0].claimedBy).toBe("a");
  });

  it("rejects submit from a non-claimer", () => {
    let s = addConnection(addConnection(initialRoomState(), "a"), "b");
    s = claimLane(s, "a", 0).state;
    const res = submitHorse(s, "b", 0, "X", "Y", "data:image/x");
    expect(res.error).toBeTruthy();
    expect(res.state.lanes[0].filled).toBe(false);
  });

  it("release clears the lane", () => {
    let s = addConnection(initialRoomState(), "a");
    s = fill(s, "a", 0);
    s = releaseLane(s, "a", 0).state;
    expect(s.lanes[0].claimedBy).toBeNull();
    expect(s.lanes[0].filled).toBe(false);
  });

  it("only host can start and only when all lanes filled", () => {
    let s = addConnection(addConnection(initialRoomState(), "a"), "b");
    for (let i = 0; i < LANE_COUNT; i++) s = fill(s, "a", i);
    expect(canStart(s, "b")).toBe(false); // not host
    expect(canStart(s, "a")).toBe(true);
    const res = startRace(s, "a");
    expect(res.error).toBeUndefined();
    expect(res.state.status).toBe("racing");
  });

  it("cannot start with an empty lane", () => {
    let s = addConnection(initialRoomState(), "a");
    for (let i = 0; i < LANE_COUNT - 1; i++) s = fill(s, "a", i);
    expect(canStart(s, "a")).toBe(false);
    expect(startRace(s, "a").error).toBeTruthy();
  });

  it("removeConnection reassigns host and releases unfilled claims but keeps filled horses", () => {
    let s = addConnection(addConnection(initialRoomState(), "a"), "b");
    s = fill(s, "a", 0);           // a: filled lane 0
    s = claimLane(s, "a", 1).state; // a: unfilled claim lane 1
    s = removeConnection(s, "a");
    expect(s.hostId).toBe("b");
    expect(s.connections).toEqual(["b"]);
    expect(s.lanes[0].filled).toBe(true);      // filled horse persists
    expect(s.lanes[1].claimedBy).toBeNull();   // unfilled claim released
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/room-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/shared/room-state.ts`**

```ts
import type { Horse, RoomStatus } from "./protocol";
import { emptyLanes } from "./protocol";

export interface RoomState {
  status: RoomStatus;
  hostId: string | null;
  connections: string[];
  lanes: Horse[];
}

export function initialRoomState(): RoomState {
  return { status: "lobby", hostId: null, connections: [], lanes: emptyLanes() };
}

function clone(s: RoomState): RoomState {
  return {
    status: s.status,
    hostId: s.hostId,
    connections: [...s.connections],
    lanes: s.lanes.map((l) => ({ ...l })),
  };
}

export function addConnection(s: RoomState, id: string): RoomState {
  if (s.connections.includes(id)) return s;
  const next = clone(s);
  next.connections.push(id);
  if (next.hostId === null) next.hostId = id;
  return next;
}

export function removeConnection(s: RoomState, id: string): RoomState {
  const next = clone(s);
  next.connections = next.connections.filter((c) => c !== id);
  for (const lane of next.lanes) {
    if (lane.claimedBy === id && !lane.filled) {
      lane.claimedBy = null;
    }
  }
  if (next.hostId === id) {
    next.hostId = next.connections[0] ?? null;
  }
  return next;
}

export function claimLane(
  s: RoomState,
  id: string,
  lane: number
): { state: RoomState; error?: string } {
  const target = s.lanes[lane];
  if (!target) return { state: s, error: "Invalid lane" };
  if (target.claimedBy && target.claimedBy !== id) {
    return { state: s, error: "Lane already claimed" };
  }
  const next = clone(s);
  next.lanes[lane].claimedBy = id;
  return { state: next };
}

export function submitHorse(
  s: RoomState,
  id: string,
  lane: number,
  horseName: string,
  personName: string,
  image: string
): { state: RoomState; error?: string } {
  const target = s.lanes[lane];
  if (!target) return { state: s, error: "Invalid lane" };
  if (target.claimedBy !== id) return { state: s, error: "You do not own this lane" };
  if (!horseName.trim() || !personName.trim() || !image) {
    return { state: s, error: "Horse name, person name, and image are required" };
  }
  const next = clone(s);
  const l = next.lanes[lane];
  l.horseName = horseName.trim();
  l.personName = personName.trim();
  l.image = image;
  l.filled = true;
  return { state: next };
}

export function releaseLane(
  s: RoomState,
  id: string,
  lane: number
): { state: RoomState; error?: string } {
  const target = s.lanes[lane];
  if (!target) return { state: s, error: "Invalid lane" };
  if (target.claimedBy !== id) return { state: s, error: "You do not own this lane" };
  const next = clone(s);
  next.lanes[lane] = {
    lane,
    claimedBy: null,
    horseName: "",
    personName: "",
    image: null,
    filled: false,
  };
  return { state: next };
}

export function canStart(s: RoomState, id: string): boolean {
  return (
    s.status === "lobby" &&
    s.hostId === id &&
    s.lanes.every((l) => l.filled)
  );
}

export function startRace(
  s: RoomState,
  id: string
): { state: RoomState; error?: string } {
  if (!canStart(s, id)) {
    return { state: s, error: "Cannot start: must be host and all lanes filled" };
  }
  const next = clone(s);
  next.status = "racing";
  return { state: next };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/room-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/room-state.ts tests/room-state.test.ts
git commit -m "feat: add pure room-state reducers"
```

---

### Task 6: RaceRoom Durable Object + Worker routing (integration-tested)

**Files:**
- Create: `src/server/room.ts`
- Modify: `src/server/index.ts` (route `/ws?code=` to the DO), `wrangler.toml` (DO binding + migration)
- Create: `vitest.workers.config.ts`
- Test: `tests/workers/room.test.ts`

**Interfaces:**
- Consumes: all `room-state.ts` reducers; `simulate` (race-sim.ts); `COUNTDOWN_MS` (constants.ts); `ClientMessage`, `ServerMessage` (protocol.ts).
- Produces: `RaceRoom` DO class exported from `src/server/room.ts`; `Env` gains `RACE_ROOM: DurableObjectNamespace`.
- Behavior: first WS to a room is host. Every state change broadcasts a fresh `room_state` to all sockets (each with its own `youId`). `start_race` from host runs `simulate(Date.now())`, sets status `racing`, and broadcasts `race_start{script, startAt=Date.now()+COUNTDOWN_MS}`. Uses WebSocket hibernation; connection id stored via `serializeAttachment`.

- [ ] **Step 1: Create `vitest.workers.config.ts`**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["tests/workers/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

- [ ] **Step 2: Write the failing integration test** — `tests/workers/room.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import type { ServerMessage } from "../../src/shared/protocol";

// Helper: open a WS to a room and collect server messages.
async function connect(code: string): Promise<{ ws: WebSocket; inbox: ServerMessage[] }> {
  const id = env.RACE_ROOM.idFromName(code);
  const stub = env.RACE_ROOM.get(id);
  const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket!;
  ws.accept();
  const inbox: ServerMessage[] = [];
  ws.addEventListener("message", (e) => inbox.push(JSON.parse(e.data as string)));
  return { ws, inbox };
}

const nextTick = () => new Promise((r) => setTimeout(r, 20));

describe("RaceRoom", () => {
  it("sends room_state on connect and marks first client host", async () => {
    const { inbox } = await connect("ROOM1");
    await nextTick();
    const state = inbox.find((m) => m.type === "room_state");
    expect(state).toBeTruthy();
    if (state?.type === "room_state") {
      expect(state.hostId).toBe(state.youId);
      expect(state.lanes).toHaveLength(12);
    }
  });

  it("broadcasts race_start only after host fills all lanes and starts", async () => {
    const { ws, inbox } = await connect("ROOM2");
    await nextTick();
    for (let lane = 0; lane < 12; lane++) {
      ws.send(JSON.stringify({ type: "claim_lane", lane }));
      ws.send(JSON.stringify({
        type: "submit_horse", lane,
        horseName: `H${lane}`, personName: `P${lane}`, image: "data:image/x",
      }));
    }
    await nextTick();
    ws.send(JSON.stringify({ type: "start_race" }));
    await nextTick();
    const start = inbox.find((m) => m.type === "race_start");
    expect(start).toBeTruthy();
    if (start?.type === "race_start") {
      expect(start.script.finishOrder).toHaveLength(12);
      expect(start.startAt).toBeGreaterThan(Date.now());
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:workers`
Expected: FAIL — `RACE_ROOM` binding / `RaceRoom` not defined.

- [ ] **Step 4: Create `src/server/room.ts`**

```ts
import { DurableObject } from "cloudflare:workers";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import {
  type RoomState,
  initialRoomState,
  addConnection,
  removeConnection,
  claimLane,
  submitHorse,
  releaseLane,
  startRace,
} from "../shared/room-state";
import { simulate } from "../shared/race-sim";
import { COUNTDOWN_MS } from "../shared/constants";

interface Attachment {
  id: string;
}

export class RaceRoom extends DurableObject {
  private room: RoomState;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.room = initialRoomState();
    // Re-register connection ids for any sockets that survived hibernation.
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.id) this.room = addConnection(this.room, att.id);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    server.serializeAttachment({ id } satisfies Attachment);
    this.ctx.acceptWebSocket(server);

    this.room = addConnection(this.room, id);
    this.broadcast();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.sendTo(ws, { type: "error", message: "Malformed message" });
    }

    let error: string | undefined;
    switch (msg.type) {
      case "claim_lane":
        ({ error } = this.apply(claimLane(this.room, att.id, msg.lane)));
        break;
      case "submit_horse":
        ({ error } = this.apply(
          submitHorse(this.room, att.id, msg.lane, msg.horseName, msg.personName, msg.image)
        ));
        break;
      case "release_lane":
        ({ error } = this.apply(releaseLane(this.room, att.id, msg.lane)));
        break;
      case "start_race": {
        const res = startRace(this.room, att.id);
        if (res.error) { error = res.error; break; }
        this.room = res.state;
        const script = simulate(Date.now());
        this.broadcast();
        this.broadcastRaw({ type: "race_start", script, startAt: Date.now() + COUNTDOWN_MS });
        return;
      }
    }
    if (error) return this.sendTo(ws, { type: "error", message: error });
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att) {
      this.room = removeConnection(this.room, att.id);
      this.broadcast();
    }
  }

  private apply(res: { state: RoomState; error?: string }): { error?: string } {
    if (!res.error) this.room = res.state;
    return { error: res.error };
  }

  private broadcast(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      this.sendTo(ws, {
        type: "room_state",
        status: this.room.status,
        hostId: this.room.hostId,
        youId: att.id,
        lanes: this.room.lanes,
      });
    }
  }

  private broadcastRaw(msg: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) this.sendTo(ws, msg);
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }
}
```

- [ ] **Step 5: Update `src/server/index.ts`** to route `/ws` to the DO

```ts
export { RaceRoom } from "./room";

export interface Env {
  ASSETS: Fetcher;
  RACE_ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const code = (url.searchParams.get("code") ?? "").toUpperCase().slice(0, 8);
      if (!code) return new Response("Missing room code", { status: 400 });
      const id = env.RACE_ROOM.idFromName(code);
      return env.RACE_ROOM.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
```

- [ ] **Step 6: Update `wrangler.toml`** — add DO binding + migration

```toml
name = "draft-order-race"
main = "src/server/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./dist"
binding = "ASSETS"

[[durable_objects.bindings]]
name = "RACE_ROOM"
class_name = "RaceRoom"

[[migrations]]
tag = "v1"
new_classes = ["RaceRoom"]
```

- [ ] **Step 7: Run integration tests**

Run: `npm run test:workers`
Expected: PASS (both tests). If the pool needs `dist/` to exist, run `npm run build` first.

- [ ] **Step 8: Commit**

```bash
git add src/server/room.ts src/server/index.ts wrangler.toml vitest.workers.config.ts tests/workers/room.test.ts
git commit -m "feat: add RaceRoom Durable Object with WebSocket rooms"
```

---

### Task 7: Client image resize (pure size math + File→data URL)

**Files:**
- Create: `src/client/image-resize.ts`
- Test: `tests/image-resize.test.ts`

**Interfaces:**
- Consumes: `THUMB_MAX_PX` (constants.ts).
- Produces:
  - `fitWithin(w, h, max): { w: number; h: number }` (pure — preserves aspect ratio, never upscales).
  - `resizeImageFile(file: File, max?: number): Promise<string>` (returns a JPEG data URL; browser-only, verified manually).

- [ ] **Step 1: Write the failing test** — `tests/image-resize.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { fitWithin } from "../src/client/image-resize";

describe("fitWithin", () => {
  it("scales a landscape image so the long side equals max", () => {
    expect(fitWithin(200, 100, 64)).toEqual({ w: 64, h: 32 });
  });
  it("scales a portrait image so the long side equals max", () => {
    expect(fitWithin(100, 200, 64)).toEqual({ w: 32, h: 64 });
  });
  it("never upscales a small image", () => {
    expect(fitWithin(40, 20, 64)).toEqual({ w: 40, h: 20 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/image-resize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/client/image-resize.ts`**

```ts
import { THUMB_MAX_PX } from "../shared/constants";

export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const scale = max / longest;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export async function resizeImageFile(file: File, max = THUMB_MAX_PX): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file");
  }
  const bitmap = await createImageBitmap(file);
  const { w, h } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/image-resize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/image-resize.ts tests/image-resize.test.ts
git commit -m "feat: add client image resize"
```

---

### Task 8: Race animation stepper (pure)

**Files:**
- Create: `src/client/race-anim.ts`
- Test: `tests/race-anim.test.ts`

**Interfaces:**
- Consumes: `RaceScript` (protocol.ts); `TICKS_PER_ROUND`, `TICK_MS`, `ROUND_PAUSE_MS`, `TRACK_LENGTH_UNITS`, `DUST_THRESHOLD` (constants.ts).
- Produces:
  - `LaneFrame { progress: number; dust: boolean; finished: boolean; rank: number | null }` (`progress` is 0..1 of the track).
  - `raceDurationMs(script): number`.
  - `computeRaceFrame(script, elapsedMs): { lanes: LaneFrame[]; finishedCount: number; done: boolean }`.

Each round occupies `TICKS_PER_ROUND * TICK_MS` of movement followed by `ROUND_PAUSE_MS` of pause. A lane's position at time `t` is the sum of completed rounds' rolls plus the current round's roll scaled by how far into the movement phase we are. `dust` is true while a lane is in the movement phase of a round whose roll `> DUST_THRESHOLD`. `rank` is set from `finishOrder` once a lane's position reaches the track length.

- [ ] **Step 1: Write the failing test** — `tests/race-anim.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { computeRaceFrame, raceDurationMs } from "../src/client/race-anim";
import type { RaceScript } from "../src/shared/protocol";
import { TICK_MS, TICKS_PER_ROUND, ROUND_PAUSE_MS, TRACK_LENGTH_UNITS } from "../src/shared/constants";

// Two lanes: lane 0 wins in one round (roll >= track), lane 1 takes two rounds.
const script: RaceScript = {
  rounds: [
    [TRACK_LENGTH_UNITS, 20],
    [0, TRACK_LENGTH_UNITS],
  ],
  finishOrder: [0, 1],
};

const ROUND_MS = TICKS_PER_ROUND * TICK_MS + ROUND_PAUSE_MS;

describe("computeRaceFrame", () => {
  it("everyone at start line at t=0", () => {
    const f = computeRaceFrame(script, 0);
    expect(f.lanes[0].progress).toBe(0);
    expect(f.lanes[1].progress).toBe(0);
    expect(f.done).toBe(false);
  });

  it("marks dust during the movement phase of a big-roll round", () => {
    const f = computeRaceFrame(script, TICK_MS); // inside round 0 movement
    expect(f.lanes[1].dust).toBe(true); // lane 1 rolled 20 (>15)
  });

  it("assigns ranks and completes once past total duration", () => {
    const f = computeRaceFrame(script, raceDurationMs(script) + 1);
    expect(f.done).toBe(true);
    expect(f.lanes[0].finished).toBe(true);
    expect(f.lanes[0].rank).toBe(1);
    expect(f.lanes[1].rank).toBe(2);
    expect(f.finishedCount).toBe(2);
  });

  it("total duration spans exactly the number of rounds", () => {
    expect(raceDurationMs(script)).toBe(2 * ROUND_MS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/race-anim.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/client/race-anim.ts`**

```ts
import type { RaceScript } from "../shared/protocol";
import {
  TICKS_PER_ROUND,
  TICK_MS,
  ROUND_PAUSE_MS,
  TRACK_LENGTH_UNITS,
  DUST_THRESHOLD,
} from "../shared/constants";

export interface LaneFrame {
  progress: number;      // 0..1 along the track
  dust: boolean;
  finished: boolean;
  rank: number | null;   // 1-based finishing rank, or null
}

const MOVE_MS = TICKS_PER_ROUND * TICK_MS;
const ROUND_MS = MOVE_MS + ROUND_PAUSE_MS;

export function raceDurationMs(script: RaceScript): number {
  return script.rounds.length * ROUND_MS;
}

export function computeRaceFrame(
  script: RaceScript,
  elapsedMs: number
): { lanes: LaneFrame[]; finishedCount: number; done: boolean } {
  const laneCount = script.rounds[0]?.length ?? 0;
  const t = Math.max(0, elapsedMs);
  const currentRound = Math.min(Math.floor(t / ROUND_MS), script.rounds.length);
  const intoRound = t - currentRound * ROUND_MS;
  const moveFrac = Math.min(1, Math.max(0, intoRound / MOVE_MS)); // 0..1 within movement

  const rankOf = (lane: number): number | null => {
    const idx = script.finishOrder.indexOf(lane);
    return idx === -1 ? null : idx + 1;
  };

  const lanes: LaneFrame[] = [];
  let finishedCount = 0;

  for (let lane = 0; lane < laneCount; lane++) {
    let units = 0;
    for (let r = 0; r < currentRound; r++) units += script.rounds[r][lane];

    const currentRoll = currentRound < script.rounds.length ? script.rounds[currentRound][lane] : 0;
    units += currentRoll * moveFrac;

    const finished = units >= TRACK_LENGTH_UNITS;
    const progress = Math.min(1, units / TRACK_LENGTH_UNITS);
    const dust = currentRoll > DUST_THRESHOLD && moveFrac > 0 && moveFrac < 1 && !finished;

    if (finished) finishedCount++;
    lanes.push({ progress, dust, finished, rank: finished ? rankOf(lane) : null });
  }

  return { lanes, finishedCount, done: elapsedMs >= raceDurationMs(script) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/race-anim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/race-anim.ts tests/race-anim.test.ts
git commit -m "feat: add pure race animation stepper"
```

---

### Task 9: Typed WebSocket client (message parsing tested)

**Files:**
- Create: `src/client/ws-client.ts`
- Test: `tests/ws-client.test.ts`

**Interfaces:**
- Consumes: `ClientMessage`, `ServerMessage` (protocol.ts).
- Produces:
  - `parseServerMessage(raw: string): ServerMessage | null` (pure; tolerates junk).
  - `class RoomConnection` with `constructor(code, { onMessage, onOpen, onClose })`, `send(msg: ClientMessage)`, `close()`. Connects to `/ws?code=CODE` on the current origin (ws/wss). Browser-only parts verified manually.

- [ ] **Step 1: Write the failing test** — `tests/ws-client.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseServerMessage } from "../src/client/ws-client";

describe("parseServerMessage", () => {
  it("parses a valid room_state message", () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: "room_state", status: "lobby", hostId: "a", youId: "a", lanes: [] })
    );
    expect(msg?.type).toBe("room_state");
  });
  it("returns null for malformed json", () => {
    expect(parseServerMessage("{not json")).toBeNull();
  });
  it("returns null when type is missing", () => {
    expect(parseServerMessage(JSON.stringify({ foo: 1 }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ws-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/client/ws-client.ts`**

```ts
import type { ClientMessage, ServerMessage } from "../shared/protocol";

const KNOWN_TYPES = new Set(["room_state", "race_start", "error"]);

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.type === "string" && KNOWN_TYPES.has(obj.type)) {
      return obj as ServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export interface RoomConnectionHandlers {
  onMessage: (msg: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class RoomConnection {
  private ws: WebSocket;

  constructor(code: string, private handlers: RoomConnectionHandlers) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws?code=${encodeURIComponent(code)}`);
    this.ws.addEventListener("open", () => this.handlers.onOpen?.());
    this.ws.addEventListener("close", () => this.handlers.onClose?.());
    this.ws.addEventListener("message", (e) => {
      const msg = parseServerMessage(e.data as string);
      if (msg) this.handlers.onMessage(msg);
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/ws-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/ws-client.ts tests/ws-client.test.ts
git commit -m "feat: add typed WebSocket client"
```

---

### Task 10: Results panel + room-code generator (pure helpers tested)

**Files:**
- Create: `src/client/results.ts`
- Test: `tests/results.test.ts`

**Interfaces:**
- Consumes: `Horse`, `RaceScript` (protocol.ts).
- Produces:
  - `generateRoomCode(): string` (4 uppercase A–Z/2–9 chars, no ambiguous 0/O/1/I).
  - `standings(lanes: Horse[], finishOrder: number[]): { rank: number; horse: Horse }[]` (pure; ordering for the panel; unfinished lanes omitted).
  - `renderResults(el: HTMLElement, lanes: Horse[], finishedLanes: number[], finishOrder: number[]): void` (DOM; verified manually).

- [ ] **Step 1: Write the failing test** — `tests/results.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { generateRoomCode, standings } from "../src/client/results";
import { emptyLanes } from "../src/shared/protocol";

describe("generateRoomCode", () => {
  it("is 4 unambiguous uppercase chars", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    }
  });
});

describe("standings", () => {
  it("orders finished lanes by finishOrder and omits unfinished", () => {
    const lanes = emptyLanes();
    lanes[3].horseName = "Third-lane horse";
    lanes[7].horseName = "Seventh-lane horse";
    // Only lanes 7 then 3 have finished so far.
    const rows = standings(lanes, [7, 3]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(rows.map((r) => r.horse.lane)).toEqual([7, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/results.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/client/results.ts`**

```ts
import type { Horse } from "../shared/protocol";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
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
      ${horse.image ? `<img class="results__img" src="${horse.image}" alt="" />` : ""}
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/results.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/results.ts tests/results.test.ts
git commit -m "feat: add results panel and room-code generator"
```

---

### Task 11: Canvas race renderer + countdown overlay

**Files:**
- Create: `src/client/race-canvas.ts`, `src/client/countdown.ts`
- Test: `tests/race-canvas.test.ts`

**Interfaces:**
- Consumes: `computeRaceFrame`, `raceDurationMs`, `LaneFrame` (race-anim.ts); `Horse` (protocol.ts); `LANE_COUNT` (constants.ts).
- Produces:
  - `laneY(index, height, laneCount): number` (pure — vertical center of a lane; tested).
  - `class RaceCanvas` with `constructor(canvas, lanes)`, `start(script, startAtMs)`, `onFinishedChange(cb: (finishedLanes: number[]) => void)`, `onDone(cb: () => void)`. Uses `requestAnimationFrame`; drawing verified manually.
  - `runCountdown(el: HTMLElement, startAtMs: number, onGo: () => void): void` — shows 3/2/1/GO synced to `startAtMs`.

- [ ] **Step 1: Write the failing test** — `tests/race-canvas.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { laneY } from "../src/client/race-canvas";

describe("laneY", () => {
  it("spaces lanes evenly and centers them", () => {
    // 2 lanes in 100px → centers at 25 and 75.
    expect(laneY(0, 100, 2)).toBe(25);
    expect(laneY(1, 100, 2)).toBe(75);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/race-canvas.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/client/race-canvas.ts`**

```ts
import type { Horse } from "../shared/protocol";
import { computeRaceFrame, raceDurationMs } from "./race-anim";
import type { RaceScript } from "../shared/protocol";

const GUTTER = 150;      // left space for name + thumbnail
const FINISH_PAD = 40;   // right padding before finish line
const HORSE_PX = 40;

export function laneY(index: number, height: number, laneCount: number): number {
  const laneH = height / laneCount;
  return laneH * index + laneH / 2;
}

export class RaceCanvas {
  private ctx: CanvasRenderingContext2D;
  private images = new Map<number, HTMLImageElement>();
  private script: RaceScript | null = null;
  private startAt = 0;
  private finishedCb: (lanes: number[]) => void = () => {};
  private doneCb: () => void = () => {};
  private lastFinished = -1;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement, private lanes: Horse[]) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2d unsupported");
    this.ctx = ctx;
    for (const lane of lanes) {
      if (lane.image) {
        const img = new Image();
        img.src = lane.image;
        this.images.set(lane.lane, img);
      }
    }
  }

  onFinishedChange(cb: (lanes: number[]) => void): void { this.finishedCb = cb; }
  onDone(cb: () => void): void { this.doneCb = cb; }

  start(script: RaceScript, startAtMs: number): void {
    this.script = script;
    this.startAt = startAtMs;
    this.loop();
  }

  private loop = (): void => {
    if (!this.script) return;
    const elapsed = Date.now() - this.startAt;
    this.draw(Math.max(0, elapsed));

    const frame = computeRaceFrame(this.script, Math.max(0, elapsed));
    if (frame.finishedCount !== this.lastFinished) {
      this.lastFinished = frame.finishedCount;
      const finishedLanes = frame.lanes
        .map((f, lane) => (f.finished ? lane : -1))
        .filter((n) => n >= 0);
      this.finishedCb(finishedLanes);
    }

    if (elapsed >= raceDurationMs(this.script)) {
      this.doneCb();
      cancelAnimationFrame(this.raf);
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(elapsed: number): void {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, width, height);

    const laneCount = this.lanes.length;
    const trackStart = GUTTER;
    const trackEnd = width - FINISH_PAD;
    const trackLen = trackEnd - trackStart;
    const frame = computeRaceFrame(this.script!, elapsed);

    // Finish line.
    ctx.strokeStyle = "#fff";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(trackEnd, 0);
    ctx.lineTo(trackEnd, height);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let lane = 0; lane < laneCount; lane++) {
      const y = laneY(lane, height, laneCount);
      const horse = this.lanes[lane];
      const f = frame.lanes[lane];

      // Lane separators.
      ctx.strokeStyle = "#222";
      ctx.beginPath();
      ctx.moveTo(0, y + height / laneCount / 2);
      ctx.lineTo(width, y + height / laneCount / 2);
      ctx.stroke();

      // Gutter: name + thumbnail.
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(horse.horseName || `Lane ${lane + 1}`, 46, y);
      const img = this.images.get(lane);
      if (img?.complete && img.naturalWidth) ctx.drawImage(img, 8, y - 16, 32, 32);

      // Dust burst.
      const x = trackStart + f.progress * trackLen;
      if (f.dust) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#caa26a";
        ctx.beginPath();
        ctx.arc(x - HORSE_PX / 2 - 8, y + 8, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Horse token.
      if (img?.complete && img.naturalWidth) {
        ctx.drawImage(img, x - HORSE_PX / 2, y - HORSE_PX / 2, HORSE_PX, HORSE_PX);
      } else {
        ctx.fillStyle = "#e34";
        ctx.beginPath();
        ctx.arc(x, y, HORSE_PX / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
```

- [ ] **Step 4: Create `src/client/countdown.ts`**

```ts
export function runCountdown(el: HTMLElement, startAtMs: number, onGo: () => void): void {
  el.classList.add("countdown--active");
  const tick = () => {
    const remaining = startAtMs - Date.now();
    if (remaining <= 0) {
      el.textContent = "GO!";
      setTimeout(() => {
        el.classList.remove("countdown--active");
        el.textContent = "";
        onGo();
      }, 400);
      return;
    }
    el.textContent = String(Math.ceil(remaining / 1000));
    requestAnimationFrame(tick);
  };
  tick();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/race-canvas.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/race-canvas.ts src/client/countdown.ts tests/race-canvas.test.ts
git commit -m "feat: add canvas race renderer and countdown overlay"
```

---

### Task 12: Lobby UI (landing, lane grid, claim/submit, Start)

**Files:**
- Create: `src/client/lobby.ts`
- Test: `tests/lobby.test.ts`

**Interfaces:**
- Consumes: `Horse` (protocol.ts); `resizeImageFile` (image-resize.ts).
- Produces:
  - `laneStatus(horse, youId, hostId): "yours" | "filled" | "claimed" | "open"` (pure; tested).
  - `renderLanding(el, { onCreate, onJoin })` — Create / Join-with-code screen (DOM; manual verify).
  - `renderLobby(el, { lanes, youId, hostId, onClaim, onSubmit, onRelease, onStart })` — lane grid + host Start (DOM; manual verify). Start button present only when `youId === hostId` and all lanes filled.

- [ ] **Step 1: Write the failing test** — `tests/lobby.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { laneStatus } from "../src/client/lobby";
import { emptyLanes } from "../src/shared/protocol";

describe("laneStatus", () => {
  it("classifies each lane relative to the viewer", () => {
    const lanes = emptyLanes();
    lanes[0].claimedBy = "me";
    lanes[1].claimedBy = "other";
    lanes[2].claimedBy = "other";
    lanes[2].filled = true;
    expect(laneStatus(lanes[0], "me", "me")).toBe("yours");
    expect(laneStatus(lanes[1], "me", "me")).toBe("claimed");
    expect(laneStatus(lanes[2], "me", "me")).toBe("filled");
    expect(laneStatus(lanes[3], "me", "me")).toBe("open");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lobby.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/client/lobby.ts`**

```ts
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
        <h1>Room <span class="lobby__code">${h.code}</span></h1>
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
    ${horse.filled && horse.image ? `<img class="lane-card__img" src="${horse.image}" alt="" />` : ""}
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lobby.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lobby.ts tests/lobby.test.ts
git commit -m "feat: add lobby UI (landing, lane grid, claim/submit)"
```

---

### Task 13: App orchestrator, layout CSS, and full wiring

**Files:**
- Modify: `src/client/main.ts` (replace placeholder), `src/client/styles.css`
- Modify: `index.html` (add race/results/countdown containers — already references main.ts)

**Interfaces:**
- Consumes: everything above — `RoomConnection` (ws-client.ts), `renderLanding`/`renderLobby` (lobby.ts), `RaceCanvas` (race-canvas.ts), `runCountdown` (countdown.ts), `renderResults` (results.ts), `generateRoomCode` (results.ts), `RaceScript`/`Horse`/`ServerMessage` (protocol.ts).
- Produces: the running SPA. No new exported API; this is the composition root. Manual/E2E verification.

- [ ] **Step 1: Replace `src/client/main.ts`** with the orchestrator

```ts
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
```

- [ ] **Step 2: Replace `src/client/styles.css`** with the full layout

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: #0b0b0b; color: #f5f5f5; }
.btn { padding: 8px 14px; border: 1px solid #444; background: #1b1b1b; color: #fff; border-radius: 6px; cursor: pointer; font-size: 14px; }
.btn:hover { background: #262626; }
.btn--primary { background: #2f7d32; border-color: #2f7d32; font-weight: 600; }
.btn:disabled { opacity: .5; cursor: default; }
.input { padding: 8px 10px; border: 1px solid #444; background: #141414; color: #fff; border-radius: 6px; font-size: 14px; }

/* Landing */
.landing { max-width: 420px; margin: 12vh auto; text-align: center; display: grid; gap: 16px; }
.landing__title { font-size: 32px; }
.landing__join { display: flex; gap: 8px; justify-content: center; }

/* Lobby */
.lobby { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
.lobby__code { font-family: ui-monospace, monospace; letter-spacing: 3px; color: #7fd88a; }
.lobby__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin-top: 16px; }
.lane-card { border: 1px solid #333; border-radius: 8px; padding: 12px; background: #151515; display: grid; gap: 8px; }
.lane-card--yours { border-color: #2f7d32; }
.lane-card--filled { border-color: #3a5; }
.lane-card__img { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; }
.lane-form { display: grid; gap: 8px; }
.lane-form__row { display: flex; gap: 8px; }
.lane-form__err { color: #ff6b6b; font-size: 12px; margin: 0; }
.lobby__actions { margin-top: 20px; text-align: center; }

/* Race screen: left 3/4 track, right 1/4 results */
.race-screen { display: grid; grid-template-columns: 3fr 1fr; height: 100vh; }
.race-screen__track { position: relative; }
.race-screen__track canvas { display: block; width: 100%; height: 100%; }
.race-screen__results { border-left: 1px solid #333; padding: 16px; overflow-y: auto; background: #101010; }
.results__title { margin-top: 0; }
.results__list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.results__row { display: flex; align-items: center; gap: 8px; }
.results__rank { width: 22px; font-weight: 700; color: #7fd88a; }
.results__img { width: 28px; height: 28px; border-radius: 5px; object-fit: cover; }
.results__names { display: grid; }
.results__horse { font-weight: 600; }
.results__person { font-size: 12px; color: #aaa; }

/* Countdown overlay */
.countdown { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; font-size: 120px; font-weight: 800; color: #fff; background: rgba(0,0,0,.45); }
.countdown--active { display: flex; }

/* Toast */
.toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #a33; color: #fff; padding: 8px 14px; border-radius: 6px; }
```

- [ ] **Step 3: Verify build + typecheck + all unit tests**

Run: `npm run typecheck && npm run build && npm test`
Expected: typecheck 0 errors; `dist/` built; all unit tests pass.

- [ ] **Step 4: Manual smoke test with `wrangler dev`**

Run: `npm run build && npm run dev`
Then, in two browser windows on the printed localhost URL:
1. Window A: click **Create a Room** → note the code appears; claim lanes and fill all 12 (a single window may claim multiple lanes).
2. Window B: open the same URL, **Join** with the code → confirm lanes update live in both.
3. Window A (host): **Start Race** → both windows show synced 3-2-1, then the same race and identical final Draft Order in the right panel.

Expected: identical results in both windows; dust flashes on big rolls; names/thumbnails show in the left gutter.

- [ ] **Step 5: Commit**

```bash
git add src/client/main.ts src/client/styles.css index.html
git commit -m "feat: wire app orchestrator, race screen, and layout"
```

---

### Task 14: CI/CD, README, and repo cleanup

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`
- Remove: `DraftOrderRace.py`, `draftimg/` (superseded); keep a note in README.

**Interfaces:**
- Consumes: `npm run build`, `wrangler deploy` from Task 1.
- Produces: automated deploy on push to `main`; documented build/deploy/run commands.

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
      - run: npm run build
      - name: Deploy to Cloudflare
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 2: Create `README.md`**

```markdown
# Draft Order Race

Real-time multiplayer horse race that randomizes a 12-team fantasy draft order.
Everyone joins a room, claims a lane, names their horse and adds an image; the
host starts a synchronized race whose finish order is the draft order.

## Stack
- Cloudflare Workers + Static Assets (one deploy)
- One `RaceRoom` Durable Object per room (WebSocket, hibernation)
- Vanilla TypeScript + HTML5 Canvas front end, bundled by Vite

## Develop
```bash
npm install
npm run build      # bundle client into dist/
npm run dev        # wrangler dev (serves assets + Durable Object)
```
Open the printed localhost URL. Create a room in one tab, join with the code in
another.

## Test
```bash
npm test           # pure-logic unit tests (sim, reducers, stepper, UI helpers)
npm run test:workers  # Durable Object integration tests
```

## Build & Deploy (CI/CD)
- **Build command:** `npm run build`
- **Deploy command:** `npm run deploy`  (runs build, then `wrangler deploy`)

CI deploys on push to `main` via `.github/workflows/deploy.yml`. Set repo secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Legacy
The original Tkinter prototype lived at `DraftOrderRace.py`; this web app supersedes it.
```

- [ ] **Step 3: Remove the superseded prototype**

```bash
git rm DraftOrderRace.py
git rm -r draftimg
```

- [ ] **Step 4: Final verification**

Run: `npm ci && npm test && npm run test:workers && npm run build`
Expected: all green; `dist/` produced.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml README.md
git commit -m "chore: add CI deploy, README, and remove legacy prototype"
```

---

## Self-Review Notes (coverage vs. spec)

- **Session model / shared room:** Tasks 6, 9, 13 (DO rooms + WS client + orchestrator).
- **Minimal backend (one DO, no DB/storage):** Task 6.
- **Client-side image resize, no storage:** Task 7; used in Task 12.
- **Host creates room, host starts:** room code in URL + first-connection host (Task 6); Start gating in Tasks 5, 12, 13.
- **12 lanes, roll mechanic, dust, finish order/tie-break:** Tasks 3, 4, 8, 11.
- **Authoritative synced race:** DO runs `simulate` and broadcasts script (Task 6); clients animate identically (Tasks 8, 11, 13).
- **Layout: left 3/4 race with name gutter, right 1/4 live results:** Tasks 11, 13 (CSS), 10 (results).
- **3-2-1 countdown synced:** Task 11 (`runCountdown`) + Task 13 (`startAt`).
- **Reconnect/hibernation, host handoff, spectator on late join:** Task 6 (hibernation + `removeConnection` host reassignment); late joiners receive current `room_state` and, if racing, will not get a fresh `race_start` (documented limitation — a late joiner mid-race sees the lobby state until the next race; acceptable for v1).
- **Build & deploy commands / CI:** Tasks 1, 14.
- **Language refactor to TypeScript:** entire plan.
