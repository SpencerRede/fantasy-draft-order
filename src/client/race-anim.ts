import type { RaceScript } from "../shared/protocol";
import {
  TICKS_PER_ROUND,
  TICK_MS,
  ROUND_PAUSE_MS,
  TRACK_LENGTH_UNITS,
  DUST_THRESHOLD,
} from "../shared/constants";

export interface LaneFrame {
  progress: number;      // 0..1 along the track
  dust: boolean;
  finished: boolean;
  rank: number | null;   // 1-based finishing rank, or null
}

const MOVE_MS = TICKS_PER_ROUND * TICK_MS;
const ROUND_MS = MOVE_MS + ROUND_PAUSE_MS;

export function raceDurationMs(script: RaceScript): number {
  return script.rounds.length * ROUND_MS;
}

export function computeRaceFrame(
  script: RaceScript,
  elapsedMs: number
): { lanes: LaneFrame[]; finishedCount: number; done: boolean } {
  const laneCount = script.rounds[0]?.length ?? 0;
  const t = Math.max(0, elapsedMs);
  const currentRound = Math.min(Math.floor(t / ROUND_MS), script.rounds.length);
  const intoRound = t - currentRound * ROUND_MS;
  const moveFrac = Math.min(1, Math.max(0, intoRound / MOVE_MS)); // 0..1 within movement

  const rankOf = (lane: number): number | null => {
    const idx = script.finishOrder.indexOf(lane);
    return idx === -1 ? null : idx + 1;
  };

  const lanes: LaneFrame[] = [];
  let finishedCount = 0;

  for (let lane = 0; lane < laneCount; lane++) {
    let units = 0;
    for (let r = 0; r < currentRound; r++) units += script.rounds[r][lane];

    const currentRoll = currentRound < script.rounds.length ? script.rounds[currentRound][lane] : 0;
    units += currentRoll * moveFrac;

    const finished = units >= TRACK_LENGTH_UNITS;
    const progress = Math.min(1, units / TRACK_LENGTH_UNITS);
    const dust = currentRoll > DUST_THRESHOLD && moveFrac > 0 && moveFrac < 1 && !finished;

    if (finished) finishedCount++;
    lanes.push({ progress, dust, finished, rank: finished ? rankOf(lane) : null });
  }

  return { lanes, finishedCount, done: elapsedMs >= raceDurationMs(script) };
}
