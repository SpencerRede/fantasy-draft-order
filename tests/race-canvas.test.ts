import { describe, it, expect } from "vitest";
import { laneY } from "../src/client/race-canvas";

describe("laneY", () => {
  it("spaces lanes evenly and centers them", () => {
    // 2 lanes in 100px → centers at 25 and 75.
    expect(laneY(0, 100, 2)).toBe(25);
    expect(laneY(1, 100, 2)).toBe(75);
  });
});
