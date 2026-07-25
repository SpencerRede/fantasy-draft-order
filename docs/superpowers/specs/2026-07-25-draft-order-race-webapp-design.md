# Fantasy Draft Order Race — Web App Design

**Date:** 2026-07-25
**Status:** Approved

## Purpose

Refactor the existing single-file Tkinter desktop app (`DraftOrderRace.py`) into a
real-time, multiplayer web app deployed on Cloudflare. The app randomizes a
12-team fantasy football draft order as a horse race: each participant names a
horse, supplies an image, and gives the person's name; once all 12 lanes are
filled the host starts a synchronized race whose finish order becomes the draft
order.

## What the original does (baseline behavior to preserve)

`DraftOrderRace.py` is a Tkinter Canvas app:

- 12 players loaded from `draftconf.txt` (`Name;/path/to/image`), each a 50×50 icon.
- 12 horizontal lanes; horse name drawn to the right of the finish line.
- **Race RNG:** each round every un-finished horse rolls `randint(5,10)*2` →
  an even number in {10,12,14,16,18,20}, and advances that many track units over
  5 animation ticks (100ms each), then a 300ms pause before the next round.
  Track length = 1270 units. Every horse uses the same distribution — pure fair
  RNG, no per-horse speed advantage.
- **Boost flair:** a roll > 15 spawns a "dust" cloud image behind the horse for
  that burst (purely visual).
- First to cross 1270 is recorded; when all 12 finish, "Final Standings" shows.

## Decisions (from brainstorming)

- **Session model:** one shared live room — multiple people on different devices
  join the same session, each claims/fills one (or more) horses, everyone watches
  the same synchronized race.
- **Backend:** as minimal as possible — a single Durable Object per room. No
  database, no storage bindings.
- **Images:** resized client-side to a ~64px thumbnail and sent as a compact data
  URL over WebSocket; stored only in live room state. No R2/Images, no persistence.
- **Room & start:** host creates the room and gets a shareable code/link; only the
  host sees/presses Start, which enables once all 12 lanes are filled.
- **Deploy shape:** single Cloudflare **Workers + Static Assets** project (one
  `wrangler deploy`) — hosts the SPA and the Durable Object together.
- **Frontend:** vanilla TypeScript + HTML5 Canvas (no UI framework).

## Language refactor

Python/Tkinter → **TypeScript** end-to-end. The Tkinter Canvas animation loop
maps directly onto HTML5 Canvas; the roll/tick/dust logic ports nearly 1:1. The
backend is a TypeScript Durable Object.

## Architecture

Single Cloudflare Workers project (Workers + Static Assets), one `wrangler deploy`.

- **Frontend:** Vanilla TypeScript + HTML5 Canvas, bundled by Vite → static assets
  served by the Worker.
- **Backend:** One `RaceRoom` Durable Object per room. Holds the 12 lane slots and
  live state, fans out WebSocket messages, and computes the authoritative race on
  Start.
- **Shared module:** race simulation + message types in `/shared` so server and
  client use identical logic/types.

### Project layout

```
src/
  client/   main.ts, lobby.ts, race-canvas.ts, results.ts,
            ws-client.ts, image-resize.ts, styles.css
  server/   index.ts (Worker: serves assets + /ws), room.ts (RaceRoom DO)
  shared/   protocol.ts (msg types), race-sim.ts (pure sim), constants.ts
index.html, wrangler.toml, vite.config.ts, package.json
```

## Race mechanic (ported, then tuned)

- Track = 1270 units. Each round, every un-finished horse rolls `randInt(5,10)*2`
  → {10,12,14,16,18,20} and advances that many units over 5 ticks. Roll > 15 →
  dust burst. Repeat until all cross 1270.
- **Fairness:** identical distribution for every horse.
- **Authoritative & synced:** on Start the DO runs the *entire* simulation,
  producing a **race script** (per-round rolls for all 12 horses) and the canonical
  **finish order** (tie-break: higher overshoot in the finishing round, then lower
  lane index). It broadcasts that; every browser animates the same script in
  lockstep, so all screens show the identical race and result.
- Tick/pause timing is a tunable constant, targeting a ~30–45s race.

## Screen layout

- **Left 3/4 — the race (Canvas):** 12 stacked lanes, dashed finish line near the
  right edge. A left gutter shows each horse's thumbnail + horse name + person name
  beside its lane. Dust flair on boosts.
- **Right 1/4 — live Results panel:** during lobby shows join/fill status of the 12
  slots; during the race fills in 1st, 2nd, 3rd… (thumbnail + names) the instant
  each horse finishes.

## Flow & UI

1. **Landing:** *Create Room* (→ host, shareable code/link) or *Join Room* (code).
2. **Lobby:** grid of 12 lanes. Unclaimed → *Claim*. Your claimed lane → inline
   form: image upload → horse name → person's name → Save (image resized
   client-side to ~64px thumbnail data URL, sent over WS, no storage). One person
   may claim multiple lanes, so exactly 12 humans are not required. Others' lanes
   show filled/pending.
3. **Start:** only the host sees the Start button; enabled once all 12 filled.
4. **Countdown:** synchronized full-screen 3… 2… 1… (driven by a server
   timestamp), then all horses launch simultaneously.
5. **Finish:** results panel shows full standings — the draft order.

## Message protocol (WebSocket JSON)

- **Client→Server:** `create_room`, `join_room{code}`, `claim_horse{lane}`,
  `submit_horse{lane,horseName,personName,image}`, `release_horse{lane}`,
  `start_race` (host only).
- **Server→Client:** `room_state{lanes,hostId,status}`, `lane_updated{...}`,
  `race_start{script,finishOrder,startAt}`, `error{...}`.

## Error handling & edge cases

- Client validates image type/size and resizes before send; rejects non-images.
- DO is the single authority → rejects claiming a taken lane, or non-host Start.
- **Reconnect / late join:** DO uses WebSocket hibernation; a reconnecting client
  rejoins by code and receives fresh `room_state`. Joining after Start = spectator.
- **Host leaves:** host role transfers to the earliest remaining connection.

## Testing

- **Pure sim (`race-sim.ts`):** deterministic given seed — all horses finish,
  finish-order/tie-break correctness, roll bounds in {10,12,14,16,18,20}.
- **DO reducer logic (extracted pure):** claim/submit/start state transitions and
  guard rejections.
- **Animation stepper:** given script + elapsed time → lane positions
  (unit-testable without Canvas).
- Integration via `vitest` + Miniflare (DO + WebSocket).

## CI/CD — Build & Deploy

- **Build:** `npm run build` (Vite bundles client → `dist/`).
- **Deploy:** `npx wrangler deploy` (uploads Worker + static assets + DO migration).
- `wrangler.toml` declares the assets dir, the `RaceRoom` Durable Object binding,
  and its migration.
- CI option: connect the repo to Cloudflare Workers Builds (build cmd
  `npm run build`), or a GitHub Action running `wrangler deploy` with a
  `CLOUDFLARE_API_TOKEN` secret.

## Constants (initial)

- `LANE_COUNT = 12`
- `TRACK_LENGTH_UNITS = 1270`
- Roll = `randInt(5,10) * 2` → {10,12,14,16,18,20}; dust when roll > 15
- Ticks per round = 5; tick/pause durations tuned for ~30–45s total
- Thumbnail max dimension ≈ 64px
