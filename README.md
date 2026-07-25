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
