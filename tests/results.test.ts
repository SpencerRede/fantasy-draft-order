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
