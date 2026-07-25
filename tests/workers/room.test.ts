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
  // Block body: the handler must not return a value (workerd warns otherwise).
  ws.addEventListener("message", (e) => {
    inbox.push(JSON.parse(e.data as string));
  });
  return { ws, inbox };
}

// Poll the inbox until a message of the given type arrives, or time out.
// Robust against CI scheduling delays where a fixed sleep is not enough.
async function waitFor<T extends ServerMessage["type"]>(
  inbox: ServerMessage[],
  type: T,
  timeoutMs = 3000,
): Promise<Extract<ServerMessage, { type: T }> | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = inbox.find((m) => m.type === type);
    if (found) return found as Extract<ServerMessage, { type: T }>;
    await new Promise((r) => setTimeout(r, 10));
  }
  return undefined;
}

describe("RaceRoom", () => {
  it("sends room_state on connect and marks first client host", async () => {
    const { inbox } = await connect("ROOM1");
    const state = await waitFor(inbox, "room_state");
    expect(state).toBeTruthy();
    if (state?.type === "room_state") {
      expect(state.hostId).toBe(state.youId);
      expect(state.lanes).toHaveLength(12);
    }
  });

  it("broadcasts race_start only after host fills all lanes and starts", async () => {
    const { ws, inbox } = await connect("ROOM2");
    await waitFor(inbox, "room_state");
    for (let lane = 0; lane < 12; lane++) {
      ws.send(JSON.stringify({ type: "claim_lane", lane }));
      ws.send(JSON.stringify({
        type: "submit_horse", lane,
        horseName: `H${lane}`, personName: `P${lane}`, image: "data:image/x",
      }));
    }
    // Messages from one socket are processed in FIFO order, so start_race is
    // handled after all submits above.
    ws.send(JSON.stringify({ type: "start_race" }));
    const start = await waitFor(inbox, "race_start");
    expect(start).toBeTruthy();
    if (start?.type === "race_start") {
      expect(start.script.finishOrder).toHaveLength(12);
      expect(start.startAt).toBeGreaterThan(Date.now());
    }
  });

  it("rejects start_race from a non-host and sends an error, no race_start", async () => {
    const host = await connect("ROOMNH");
    await waitFor(host.inbox, "room_state");
    const guest = await connect("ROOMNH");
    await waitFor(guest.inbox, "room_state");
    guest.ws.send(JSON.stringify({ type: "start_race" }));
    const err = await waitFor(guest.inbox, "error");
    expect(err).toBeTruthy();
    expect(guest.inbox.find((m) => m.type === "race_start")).toBeFalsy();
  });

  it("does not start for the host until all lanes are filled", async () => {
    const { ws, inbox } = await connect("ROOMUF");
    await waitFor(inbox, "room_state");
    ws.send(JSON.stringify({ type: "claim_lane", lane: 0 }));
    ws.send(JSON.stringify({
      type: "submit_horse", lane: 0, horseName: "H", personName: "P", image: "data:image/x",
    }));
    ws.send(JSON.stringify({ type: "start_race" }));
    const err = await waitFor(inbox, "error");
    expect(err).toBeTruthy();
    expect(inbox.find((m) => m.type === "race_start")).toBeFalsy();
  });

  it("persists room state to storage after a claim", async () => {
    const { ws, inbox } = await connect("ROOMPS");
    await waitFor(inbox, "room_state");
    ws.send(JSON.stringify({ type: "claim_lane", lane: 3 }));

    const id = env.RACE_ROOM.idFromName("ROOMPS");
    const stub = env.RACE_ROOM.get(id);
    // Persistence is fire-and-forget; poll storage until the claim lands.
    let stored: unknown;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      stored = await runInDurableObject(stub, async (_instance, state) =>
        state.storage.get("room"),
      );
      if (stored && (stored as { lanes: { claimedBy: string | null }[] }).lanes[3].claimedBy) {
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(stored).toBeTruthy();
    expect((stored as { lanes: { claimedBy: string | null }[] }).lanes[3].claimedBy).toBeTruthy();
  });
});
