import { ROLL_MIN, ROLL_MAX } from "./constants";

// mulberry32 — small, fast, deterministic PRNG.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mirrors Python randint(ROLL_MIN, ROLL_MAX) * 2 (inclusive on both ends).
export function rollFor(rng: () => number): number {
  const span = ROLL_MAX - ROLL_MIN + 1; // inclusive
  const half = ROLL_MIN + Math.floor(rng() * span);
  return half * 2;
}
