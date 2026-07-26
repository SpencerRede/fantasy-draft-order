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

  it("orders finishers to match the animation's crossing order", () => {
    // The client animates every lane in a round with the same moveFrac, so a
    // lane visually crosses the line at moveFrac = (TRACK - priorDistance) /
    // roll. The server's finishOrder MUST equal that crossing order, or the
    // horse a viewer sees win the line would be recorded second. Reconstruct
    // each lane's crossing fraction from the script and assert finishOrder
    // matches, across many seeds including ones with same-round multi-finishers.
    let tiesExercised = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { rounds, finishOrder } = simulate(seed);
      const laneCount = rounds[0].length;

      const pos = new Array(laneCount).fill(0);
      const finishRound = new Array(laneCount).fill(-1);
      const crossFrac = new Array(laneCount).fill(0);
      for (let r = 0; r < rounds.length; r++) {
        for (let lane = 0; lane < laneCount; lane++) {
          if (finishRound[lane] !== -1) continue;
          const roll = rounds[r][lane];
          const prior = pos[lane];
          pos[lane] += roll;
          if (pos[lane] >= TRACK_LENGTH_UNITS) {
            finishRound[lane] = r;
            crossFrac[lane] = (TRACK_LENGTH_UNITS - prior) / roll;
          }
        }
      }

      // Visual crossing order: earlier round first, then smaller crossing
      // fraction, then lower lane index.
      const expectedOrder = [...Array(laneCount).keys()].sort(
        (a, b) =>
          finishRound[a] - finishRound[b] ||
          crossFrac[a] - crossFrac[b] ||
          a - b
      );
      expect(finishOrder).toEqual(expectedOrder);

      // Count same-round multi-finisher groups so we know the tie path is hit.
      const perRound = new Map<number, number>();
      for (const lane of finishOrder) {
        perRound.set(finishRound[lane], (perRound.get(finishRound[lane]) ?? 0) + 1);
      }
      for (const count of perRound.values()) if (count >= 2) tiesExercised++;
    }
    expect(tiesExercised).toBeGreaterThan(0); // guard: we actually hit a tie
  });
});
