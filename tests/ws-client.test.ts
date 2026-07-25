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
