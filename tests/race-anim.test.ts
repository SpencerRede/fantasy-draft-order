import { describe, it, expect } from "vitest";
import { computeRaceFrame, raceDurationMs } from "../src/client/race-anim";
import type { RaceScript } from "../src/shared/protocol";
import { TICK_MS, TICKS_PER_ROUND, ROUND_PAUSE_MS, TRACK_LENGTH_UNITS } from "../src/shared/constants";

// Two lanes: lane 0 wins in one round (roll >= track), lane 1 takes two rounds.
const script: RaceScript = {
  rounds: [
    [TRACK_LENGTH_UNITS, 20],
    [0, TRACK_LENGTH_UNITS],
  ],
  finishOrder: [0, 1],
};

const ROUND_MS = TICKS_PER_ROUND * TICK_MS + ROUND_PAUSE_MS;

describe("computeRaceFrame", () => {
  it("everyone at start line at t=0", () => {
    const f = computeRaceFrame(script, 0);
    expect(f.lanes[0].progress).toBe(0);
    expect(f.lanes[1].progress).toBe(0);
    expect(f.done).toBe(false);
  });

  it("marks dust during the movement phase of a big-roll round", () => {
    const f = computeRaceFrame(script, TICK_MS); // inside round 0 movement
    expect(f.lanes[1].dust).toBe(true); // lane 1 rolled 20 (>15)
  });

  it("assigns ranks and completes once past total duration", () => {
    const f = computeRaceFrame(script, raceDurationMs(script) + 1);
    expect(f.done).toBe(true);
    expect(f.lanes[0].finished).toBe(true);
    expect(f.lanes[0].rank).toBe(1);
    expect(f.lanes[1].rank).toBe(2);
    expect(f.finishedCount).toBe(2);
  });

  it("total duration spans exactly the number of rounds", () => {
    expect(raceDurationMs(script)).toBe(2 * ROUND_MS);
  });
});
