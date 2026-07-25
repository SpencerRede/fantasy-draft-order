import { makeRng, rollFor } from "./rng";
import { LANE_COUNT, TRACK_LENGTH_UNITS } from "./constants";
import type { RaceScript } from "./protocol";

export function simulate(seed: number, laneCount = LANE_COUNT): RaceScript {
  const rng = makeRng(seed);
  const positions = new Array(laneCount).fill(0);
  const finished = new Array(laneCount).fill(false);
  const rounds: number[][] = [];
  const finishOrder: number[] = [];

  while (finishOrder.length < laneCount) {
    const round = new Array(laneCount).fill(0);
    const finishersThisRound: { lane: number; overshoot: number }[] = [];

    for (let lane = 0; lane < laneCount; lane++) {
      if (finished[lane]) continue;
      const roll = rollFor(rng);
      round[lane] = roll;
      positions[lane] += roll;
      if (positions[lane] >= TRACK_LENGTH_UNITS) {
        finished[lane] = true;
        finishersThisRound.push({
          lane,
          overshoot: positions[lane] - TRACK_LENGTH_UNITS,
        });
      }
    }

    finishersThisRound.sort(
      (a, b) => b.overshoot - a.overshoot || a.lane - b.lane
    );
    for (const f of finishersThisRound) finishOrder.push(f.lane);

    rounds.push(round);
  }

  return { rounds, finishOrder };
}
