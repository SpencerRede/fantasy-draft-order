import { describe, it, expect } from "vitest";
import { makeRng, rollFor } from "../src/shared/rng";

describe("makeRng", () => {
  it("is deterministic for a given seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    seqA.forEach((n) => {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    });
  });
});

describe("rollFor", () => {
  it("only ever returns even values in {2,4,…,30}", () => {
    const rng = makeRng(7);
    const allowed = new Set([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]);
    for (let i = 0; i < 5000; i++) {
      expect(allowed.has(rollFor(rng))).toBe(true);
    }
  });
});
