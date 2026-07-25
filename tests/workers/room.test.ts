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

  it("rejects start_race from a non-host and sends an error, no race_start", async () => {
    const host = await connect("ROOMNH");
    await nextTick();
    const guest = await connect("ROOMNH");
    await nextTick();
    guest.ws.send(JSON.stringify({ type: "start_race" }));
    await nextTick();
    expect(guest.inbox.find((m) => m.type === "race_start")).toBeFalsy();
    expect(guest.inbox.find((m) => m.type === "error")).toBeTruthy();
    void host;
  });

  it("does not start for the host until all lanes are filled", async () => {
    const { ws, inbox } = await connect("ROOMUF");
    await nextTick();
    ws.send(JSON.stringify({ type: "claim_lane", lane: 0 }));
    ws.send(JSON.stringify({
      type: "submit_horse", lane: 0, horseName: "H", personName: "P", image: "data:image/x",
    }));
    await nextTick();
    ws.send(JSON.stringify({ type: "start_race" }));
    await nextTick();
    expect(inbox.find((m) => m.type === "race_start")).toBeFalsy();
    expect(inbox.find((m) => m.type === "error")).toBeTruthy();
  });

  it("persists room state to storage after a claim", async () => {
    const { ws } = await connect("ROOMPS");
    await nextTick();
    ws.send(JSON.stringify({ type: "claim_lane", lane: 3 }));
    await nextTick();
    const id = env.RACE_ROOM.idFromName("ROOMPS");
    const stub = env.RACE_ROOM.get(id);
    const stored = await runInDurableObject(stub, async (_instance, state) => {
      return state.storage.get("room");
    });
    expect(stored).toBeTruthy();
    expect((stored as { lanes: { claimedBy: string | null }[] }).lanes[3].claimedBy).toBeTruthy();
  });
});
