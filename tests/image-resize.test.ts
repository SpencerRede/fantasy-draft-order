import { describe, it, expect } from "vitest";
import { fitWithin } from "../src/client/image-resize";

describe("fitWithin", () => {
  it("scales a landscape image so the long side equals max", () => {
    expect(fitWithin(200, 100, 64)).toEqual({ w: 64, h: 32 });
  });
  it("scales a portrait image so the long side equals max", () => {
    expect(fitWithin(100, 200, 64)).toEqual({ w: 32, h: 64 });
  });
  it("never upscales a small image", () => {
    expect(fitWithin(40, 20, 64)).toEqual({ w: 40, h: 20 });
  });
});
