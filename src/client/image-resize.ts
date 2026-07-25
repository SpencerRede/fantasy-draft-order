import { THUMB_MAX_PX } from "../shared/constants";

export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const scale = max / longest;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export async function resizeImageFile(file: File, max = THUMB_MAX_PX): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file");
  }
  const bitmap = await createImageBitmap(file);
  const { w, h } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}
