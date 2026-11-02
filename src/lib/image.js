// Cover images: scaled down and re-encoded as JPEG before they're saved, so
// they stay small in your library (and in the sync folder). Covers show at
// about 280px wide, so 560px covers high-density screens.

import { coverInfo, coverWindow, bookShaped } from "./cover.js";

const MAX_W = 560;
const QUALITY = 0.8;

function load(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That doesn't look like an image."));
    img.src = src;
  });
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

/** A File or data URL → a small JPEG data URL. */
export async function shrinkImage(src, { maxW = MAX_W, quality = QUALITY } = {}) {
  const url = typeof src === "string" ? src : await readFile(src);
  const img = await load(url);
  const scale = Math.min(1, maxW / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL("image/jpeg", quality);
  // Already small and not worth re-encoding? Keep the original.
  return typeof src === "string" && src.length <= out.length ? src : out;
}

/**
 * A cover made a book's shape (2:3), as a JPEG data URL, the way it's shown
 * (lib/cover.js): plain margins trimmed, plain sides extended, or else cut at
 * `pos` (0–1 along the side with room to spare; where it has the most detail
 * if left out). A picture that's a book's shape already comes back as it is.
 */
export async function cutToBook(src, pos = null) {
  const info = await coverInfo(src);
  if (bookShaped(info.aspect)) return info.src;
  const img = await load(info.src);
  const win = coverWindow(img.width, img.height, pos ?? info.pos);
  const scale = Math.min(1, MAX_W / win.w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(win.w * scale));
  canvas.height = Math.max(1, Math.round(win.h * scale));
  canvas.getContext("2d").drawImage(img, win.x, win.y, win.w, win.h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", QUALITY);
}
