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

  it("orders same-round finishers by larger overshoot then lower lane index", () => {
    // Scan seeds for races where >=2 lanes finish in the same round, then verify
    // that round's finisher segment in finishOrder is sorted by
    // (overshoot desc, lane asc). Reconstructs overshoots from the race script.
    let tiesExercised = 0;
    for (let seed = 1; seed <= 400 && tiesExercised < 5; seed++) {
      const { rounds, finishOrder } = simulate(seed);
      const laneCount = rounds[0].length;

      const pos = new Array(laneCount).fill(0);
      const finishRound = new Array(laneCount).fill(-1);
      const overshoot = new Array(laneCount).fill(0);
      for (let r = 0; r < rounds.length; r++) {
        for (let lane = 0; lane < laneCount; lane++) {
          if (finishRound[lane] !== -1) continue;
          pos[lane] += rounds[r][lane];
          if (pos[lane] >= TRACK_LENGTH_UNITS) {
            finishRound[lane] = r;
            overshoot[lane] = pos[lane] - TRACK_LENGTH_UNITS;
          }
        }
      }

      // Group lanes by the round they finished, preserving finishOrder sequence.
      const byRound = new Map<number, number[]>();
      for (const lane of finishOrder) {
        const r = finishRound[lane];
        const arr = byRound.get(r) ?? [];
        arr.push(lane);
        byRound.set(r, arr);
      }

      for (const lanes of byRound.values()) {
        if (lanes.length < 2) continue;
        tiesExercised++;
        const expected = [...lanes].sort(
          (a, b) => overshoot[b] - overshoot[a] || a - b
        );
        expect(lanes).toEqual(expected);
      }
    }
    expect(tiesExercised).toBeGreaterThan(0); // guard: we actually hit a tie
  });
});
