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
