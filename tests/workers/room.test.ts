import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
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
