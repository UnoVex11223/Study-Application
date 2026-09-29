// Cover images: scaled down and re-encoded as JPEG before they're saved, so
// they stay small in your library (and in the sync folder). Covers show at
// about 280px wide, so 560px covers high-density screens.

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
