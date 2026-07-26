export const LANE_COUNT = 12;
export const TRACK_LENGTH_UNITS = 1270;
export const TICKS_PER_ROUND = 5;

// Roll = randInt(ROLL_MIN, ROLL_MAX) * 2  →  {2,4,…,30}. Wide spread so a horse
// can barely move (2) or surge ahead (30) on any given round.
export const ROLL_MIN = 1;
export const ROLL_MAX = 15;
export const DUST_THRESHOLD = 15; // roll > this spawns dust (the bigger bursts)

// Animation timing (client only; tuned for ~30-45s race).
export const TICK_MS = 60;
export const ROUND_PAUSE_MS = 120;
export const COUNTDOWN_MS = 3500; // 3..2..1..go overlay window

// Image thumbnail max dimension (px).
export const THUMB_MAX_PX = 64;
