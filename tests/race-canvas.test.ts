import { describe, it, expect } from "vitest";
import { laneY, canvasMetrics } from "../src/client/race-canvas";

describe("laneY", () => {
  it("spaces lanes evenly and centers them", () => {
    // 2 lanes in 100px → centers at 25 and 75.
    expect(laneY(0, 100, 2)).toBe(25);
    expect(laneY(1, 100, 2)).toBe(75);
  });
});

describe("canvasMetrics", () => {
  it("uses full desktop sizing on a large canvas", () => {
    const m = canvasMetrics(1200, 800, 12);
    expect(m.gutter).toBe(150);
    expect(m.horsePx).toBe(40);
    expect(m.gutterFont).toBe(13);
    expect(m.thumbPx).toBe(32);
  });

  it("shrinks the gutter and horse token on a small mobile canvas", () => {
    const desktop = canvasMetrics(1200, 800, 12);
    const mobile = canvasMetrics(360, 420, 12);
    expect(mobile.gutter).toBeLessThan(desktop.gutter);
    expect(mobile.horsePx).toBeLessThan(desktop.horsePx);
  });

  it("never drops below the legibility floors on a tiny canvas", () => {
    const m = canvasMetrics(200, 200, 12);
    expect(m.gutter).toBeGreaterThanOrEqual(56);
    expect(m.horsePx).toBeGreaterThanOrEqual(18);
    expect(m.thumbPx).toBeGreaterThanOrEqual(16);
    expect(m.gutterFont).toBeGreaterThanOrEqual(9);
  });
});
