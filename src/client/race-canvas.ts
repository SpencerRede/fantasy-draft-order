import type { Horse } from "../shared/protocol";
import { computeRaceFrame, raceDurationMs } from "./race-anim";
import type { RaceScript } from "../shared/protocol";
import { DEFAULT_HORSE_IMAGE, DUST_IMAGE } from "./assets";

const FINISH_PAD = 40;   // right padding before finish line

export function laneY(index: number, height: number, laneCount: number): number {
  const laneH = height / laneCount;
  return laneH * index + laneH / 2;
}

export interface CanvasMetrics {
  gutter: number;      // left name/thumbnail area width (= track start x)
  horsePx: number;     // horse token size
  gutterFont: number;  // name font size in px
  thumbPx: number;     // gutter thumbnail size
}

// Scale the fixed layout to the canvas so the race stays legible when it is
// minimized to a small area (e.g. the top 2/3 of a phone screen). On desktop
// widths these clamp back to the original 150 / 40 / 13 / 32 values.
export function canvasMetrics(width: number, height: number, laneCount: number): CanvasMetrics {
  const laneH = height / Math.max(1, laneCount);
  return {
    gutter: Math.max(56, Math.min(150, width * 0.28)),
    horsePx: Math.max(18, Math.min(40, laneH * 0.7)),
    gutterFont: Math.max(9, Math.min(13, (width * 0.28) / 11.5)),
    thumbPx: Math.max(16, Math.min(32, width * 0.28 * 0.24)),
  };
}

export class RaceCanvas {
  private ctx: CanvasRenderingContext2D;
  private images = new Map<number, HTMLImageElement>();
  private dustImg: HTMLImageElement;
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
    // Every lane gets an image: the player's upload, or the default horse.
    for (const lane of lanes) {
      const img = new Image();
      img.src = lane.image || DEFAULT_HORSE_IMAGE;
      this.images.set(lane.lane, img);
    }
    this.dustImg = new Image();
    this.dustImg.src = DUST_IMAGE;
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

    const laneCount = this.lanes.length;
    const m = canvasMetrics(width, height, laneCount);
    const trackStart = m.gutter;
    const trackEnd = width - FINISH_PAD;
    const thumbX = 6;
    const nameX = thumbX + m.thumbPx + 6;
    const trackLen = trackEnd - trackStart;
    const laneH = height / laneCount;
    const frame = computeRaceFrame(this.script!, elapsed);

    // Turf: alternating mowed-grass greens per lane.
    const GRASS = ["#4f8f43", "#3f7a35"]; // light, slightly darker
    for (let lane = 0; lane < laneCount; lane++) {
      ctx.fillStyle = GRASS[lane % 2];
      ctx.fillRect(0, lane * laneH, width, laneH);
    }
    // White picket fences separating each lane (near-top-down ~70° view).
    for (let b = 1; b < laneCount; b++) {
      this.drawFence(b * laneH, width, laneH);
    }

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

      // Gutter: thumbnail + name (name truncated to fit the gutter width).
      const img = this.images.get(lane);
      if (img?.complete && img.naturalWidth) {
        ctx.drawImage(img, thumbX, y - m.thumbPx / 2, m.thumbPx, m.thumbPx);
      }
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${m.gutterFont}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      const maxNameW = Math.max(8, m.gutter - nameX - 4);
      let name = horse.horseName || `Lane ${lane + 1}`;
      if (ctx.measureText(name).width > maxNameW) {
        while (name.length > 1 && ctx.measureText(name + "…").width > maxNameW) {
          name = name.slice(0, -1);
        }
        name += "…";
      }
      // Drop shadow keeps the white name legible over the bright grass.
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
      ctx.fillText(name, nameX, y);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Dust burst: a scaled-down dust sprite kicked up behind the horse,
      // aligned with the bottom-left corner of the horse image.
      const x = trackStart + f.progress * trackLen;
      if (f.dust && this.dustImg.complete && this.dustImg.naturalWidth) {
        const dw = m.horsePx * 0.8;
        const dh = dw * (this.dustImg.naturalHeight / this.dustImg.naturalWidth);
        const horseLeft = x - m.horsePx / 2;
        const horseBottom = y + m.horsePx / 2;
        const dustX = horseLeft - dw * 0.7;  // trails behind (to the left)
        const dustY = horseBottom - dh;      // bottom aligned with the horse
        ctx.globalAlpha = 0.85;
        ctx.drawImage(this.dustImg, dustX, dustY, dw, dh);
        ctx.globalAlpha = 1;
      }

      // Horse token.
      if (img?.complete && img.naturalWidth) {
        ctx.drawImage(img, x - m.horsePx / 2, y - m.horsePx / 2, m.horsePx, m.horsePx);
      } else {
        ctx.fillStyle = "#e34";
        ctx.beginPath();
        ctx.arc(x, y, m.horsePx / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // A low white picket fence along a lane boundary, drawn as if viewed from
  // ~70° above: short pointed pickets standing just above the boundary line,
  // two horizontal rails, and a soft ground shadow below for depth.
  private drawFence(yBoundary: number, width: number, laneH: number): void {
    const ctx = this.ctx;
    const pickH = Math.max(5, Math.min(14, laneH * 0.22));
    const pickW = 3;
    const spacing = 14;
    const railTop = yBoundary - pickH;

    // Ground shadow just below the fence.
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, yBoundary + 2);
    ctx.lineTo(width, yBoundary + 2);
    ctx.stroke();

    // Two horizontal rails (upper rail + one on the boundary).
    ctx.strokeStyle = "#eef0e8";
    ctx.lineWidth = Math.max(1.5, pickH * 0.16);
    ctx.beginPath();
    ctx.moveTo(0, railTop + pickH * 0.4);
    ctx.lineTo(width, railTop + pickH * 0.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, yBoundary);
    ctx.lineTo(width, yBoundary);
    ctx.stroke();

    // Evenly spaced pointed pickets.
    ctx.fillStyle = "#f6f7f1";
    for (let x = spacing / 2; x < width; x += spacing) {
      ctx.fillRect(x - pickW / 2, railTop, pickW, pickH);
      ctx.beginPath();
      ctx.moveTo(x - pickW / 2, railTop);
      ctx.lineTo(x, railTop - pickH * 0.4);
      ctx.lineTo(x + pickW / 2, railTop);
      ctx.closePath();
      ctx.fill();
    }
  }
}
