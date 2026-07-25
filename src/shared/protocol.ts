import { LANE_COUNT } from "./constants";

export interface Horse {
  lane: number;              // 0..LANE_COUNT-1
  claimedBy: string | null;  // connection id, or null if unclaimed
  horseName: string;
  personName: string;
  image: string | null;      // data URL thumbnail, or null
  filled: boolean;           // true once submitted with name+person+image
}

export type RoomStatus = "lobby" | "racing" | "finished";

export interface RaceScript {
  // rounds[roundIndex][lane] = roll applied that round (0 if already finished)
  rounds: number[][];
  // lane indices in finishing order, 1st .. last
  finishOrder: number[];
}

export type ClientMessage =
  | { type: "claim_lane"; lane: number }
  | { type: "submit_horse"; lane: number; horseName: string; personName: string; image: string }
  | { type: "release_lane"; lane: number }
  | { type: "start_race" };

export type ServerMessage =
  | { type: "room_state"; status: RoomStatus; hostId: string | null; youId: string; lanes: Horse[] }
  | { type: "race_start"; script: RaceScript; startAt: number }
  | { type: "error"; message: string };

export function emptyLanes(): Horse[] {
  return Array.from({ length: LANE_COUNT }, (_, i) => ({
    lane: i,
    claimedBy: null,
    horseName: "",
    personName: "",
    image: null,
    filled: false,
  }));
}
