import type { Horse } from "../shared/protocol";
import { computeRaceFrame, raceDurationMs } from "./race-anim";
import type { RaceScript } from "../shared/protocol";

const GUTTER = 150;      // left space for name + thumbnail
const FINISH_PAD = 40;   // right padding before finish line
const HORSE_PX = 40;

export function laneY(index: number, height: number, laneCount: number): number {
  const laneH = height / laneCount;
  return laneH * index + laneH / 2;
}

export class RaceCanvas {
  private ctx: CanvasRenderingContext2D;
  private images = new Map<number, HTMLImageElement>();
  private script: RaceScript | null = null;
  private startAt = 0;
  private finishedCb: (lanes: number[]) => void = () => {};
  private doneCb: () => void = () => {};
  private lastFinished = -1;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement, private lanes: Horse[]) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2d unsupported");
    this.ctx = ctx;
    for (const lane of lanes) {
      if (lane.image) {
        const img = new Image();
        img.src = lane.image;
        this.images.set(lane.lane, img);
      }
    }
  }

  onFinishedChange(cb: (lanes: number[]) => void): void { this.finishedCb = cb; }
  onDone(cb: () => void): void { this.doneCb = cb; }

  start(script: RaceScript, startAtMs: number): void {
    this.script = script;
    this.startAt = startAtMs;
    this.loop();
  }

  private loop = (): void => {
    if (!this.script) return;
    const elapsed = Date.now() - this.startAt;
    this.draw(Math.max(0, elapsed));

    const frame = computeRaceFrame(this.script, Math.max(0, elapsed));
    if (frame.finishedCount !== this.lastFinished) {
      this.lastFinished = frame.finishedCount;
      const finishedLanes = frame.lanes
        .map((f, lane) => (f.finished ? lane : -1))
        .filter((n) => n >= 0);
      this.finishedCb(finishedLanes);
    }

    if (elapsed >= raceDurationMs(this.script)) {
      this.doneCb();
      cancelAnimationFrame(this.raf);
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(elapsed: number): void {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, width, height);

    const laneCount = this.lanes.length;
    const trackStart = GUTTER;
    const trackEnd = width - FINISH_PAD;
    const trackLen = trackEnd - trackStart;
    const frame = computeRaceFrame(this.script!, elapsed);

    // Finish line.
    ctx.strokeStyle = "#fff";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(trackEnd, 0);
    ctx.lineTo(trackEnd, height);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let lane = 0; lane < laneCount; lane++) {
      const y = laneY(lane, height, laneCount);
      const horse = this.lanes[lane];
      const f = frame.lanes[lane];

      // Lane separators.
      ctx.strokeStyle = "#222";
      ctx.beginPath();
      ctx.moveTo(0, y + height / laneCount / 2);
      ctx.lineTo(width, y + height / laneCount / 2);
      ctx.stroke();

      // Gutter: name + thumbnail.
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(horse.horseName || `Lane ${lane + 1}`, 46, y);
      const img = this.images.get(lane);
      if (img?.complete && img.naturalWidth) ctx.drawImage(img, 8, y - 16, 32, 32);

      // Dust burst.
      const x = trackStart + f.progress * trackLen;
      if (f.dust) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#caa26a";
        ctx.beginPath();
        ctx.arc(x - HORSE_PX / 2 - 8, y + 8, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Horse token.
      if (img?.complete && img.naturalWidth) {
        ctx.drawImage(img, x - HORSE_PX / 2, y - HORSE_PX / 2, HORSE_PX, HORSE_PX);
      } else {
        ctx.fillStyle = "#e34";
        ctx.beginPath();
        ctx.arc(x, y, HORSE_PX / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
