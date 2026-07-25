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
