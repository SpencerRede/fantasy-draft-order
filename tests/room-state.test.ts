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
