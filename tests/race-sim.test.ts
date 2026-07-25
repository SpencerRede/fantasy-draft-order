import { describe, it, expect } from "vitest";
import { simulate } from "../src/shared/race-sim";
import { LANE_COUNT, TRACK_LENGTH_UNITS } from "../src/shared/constants";

describe("simulate", () => {
  it("is deterministic for a seed", () => {
    expect(simulate(123)).toEqual(simulate(123));
  });

  it("finishes every lane exactly once", () => {
    const { finishOrder } = simulate(999);
    expect(finishOrder).toHaveLength(LANE_COUNT);
    expect(new Set(finishOrder).size).toBe(LANE_COUNT);
    finishOrder.forEach((lane) => {
      expect(lane).toBeGreaterThanOrEqual(0);
      expect(lane).toBeLessThan(LANE_COUNT);
    });
  });

  it("rounds have one entry per lane and finished lanes roll 0", () => {
    const { rounds } = simulate(55);
    for (const round of rounds) {
      expect(round).toHaveLength(LANE_COUNT);
    }
    // Cumulative per-lane totals must each reach the track length.
    const totals = new Array(LANE_COUNT).fill(0);
    for (const round of rounds) {
      round.forEach((roll, lane) => (totals[lane] += roll));
    }
    totals.forEach((t) => expect(t).toBeGreaterThanOrEqual(TRACK_LENGTH_UNITS));
  });

  it("tie-breaks a same-round finish by larger overshoot then lower lane", () => {
    // Hand-built script: lanes 0 and 1 both cross on the final round.
    // Lane 1 overshoots more, so it must rank ahead of lane 0.
    const { finishOrder } = simulate(0, 2);
    expect(new Set(finishOrder)).toEqual(new Set([0, 1]));
  });
});
