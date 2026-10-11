// Covers on the shelf are shown as books (2:3, portrait), whatever shape the
// picture you added is.
//
// - A scan or screenshot often has a plain margin around the actual cover
//   (white paper, a page background). A margin of one colour on two or more
//   sides, ending at a clear edge, is cropped off. One band on its own is left
//   alone, since that's usually part of the design (a footer, a title strip).
// - A picture that's roughly book-shaped fills the cover. Anything else (a
//   course banner, a square thumbnail) is set on the cover as a plate, over a
//   blurred, darkened copy of itself, instead of being cropped to a sliver.
// - A book without a picture gets a plain cloth cover in one of a few muted
//   colours, picked from its title so it always gets the same one.
//
// The pixel work is pure (and tested); analyzeCover runs it in the browser
// and caches the result per image, so a cover is only looked at once.

const BOOK_SHAPED = [0.56, 0.8]; // width / height that fills a 2:3 cover

/** "fill" if the picture is close enough to a book's shape, else "framed". */
export const coverFit = (aspect) => (aspect >= BOOK_SHAPED[0] && aspect <= BOOK_SHAPED[1] ? "fill" : "framed");

const dist2 = (px, i, c) => {
  const dr = px[i] - c[0], dg = px[i + 1] - c[1], db = px[i + 2] - c[2];
  return dr * dr + dg * dg + db * db;
};

/** The pixel offsets along one line of the box, from a side inward (k = 0 is the edge). */
function line(w, box, side, k) {
  const out = [];
  if (side === "t" || side === "b") {
    const y = side === "t" ? box.t + k : box.b - 1 - k;
    for (let x = box.l; x < box.r; x++) out.push((y * w + x) * 4);
  } else {
    const x = side === "l" ? box.l + k : box.r - 1 - k;
    for (let y = box.t; y < box.b; y++) out.push((y * w + x) * 4);
  }
  return out;
}

function mean(px, idx) {
  const c = [0, 0, 0];
  for (const i of idx) { c[0] += px[i]; c[1] += px[i + 1]; c[2] += px[i + 2]; }
  return c.map(v => v / Math.max(1, idx.length));
}

const shareNear = (px, idx, c, tol2) => idx.filter(i => dist2(px, i, c) <= tol2).length / Math.max(1, idx.length);

/** How many plain lines run in from one side before a clear edge, and their colour. */
function band(px, w, box, side, { tol2, uniform, edge, maxShare }) {
  const depth = side === "t" || side === "b" ? box.b - box.t : box.r - box.l;
  const max = Math.floor(depth * maxShare);
  const first = line(w, box, side, 0);
  const color = mean(px, first);
  if (shareNear(px, first, color, tol2) < uniform) return null;
  let n = 1;
  while (n < max && shareNear(px, line(w, box, side, n), color, tol2) >= uniform) n++;
  if (n >= max) return null;
  // The margin has to end at something: most of one of the next lines differs from it.
  for (let k = n; k < Math.min(n + 3, depth); k++) {
    if (1 - shareNear(px, line(w, box, side, k), color, tol2) >= edge) return { side, n, color };
  }
  return null;
}

/**
 * The part of an RGBA image inside any plain margin, as { l, t, r, b } (r and
 * b exclusive). Returns the whole image when there's nothing to crop, or when
 * cropping would leave less than half of it.
 */
export function findFrame(px, w, h, { tol = 30, uniform = 0.96, edge = 0.5, maxShare = 0.3 } = {}) {
  const opts = { tol2: tol * tol, uniform, edge, maxShare };
  const whole = { l: 0, t: 0, r: w, b: h };
  let box = { ...whole };
  for (let pass = 0; pass < 3; pass++) {
    const found = ["t", "b", "l", "r"].map(s => band(px, w, box, s, opts)).filter(Boolean);
    // A frame runs along at least two sides in the same colour.
    const close = (a, b) => a.color.reduce((s, v, i) => s + (v - b.color[i]) ** 2, 0) <= opts.tol2;
    const frame = found.filter(x => found.some(y => y !== x && close(x, y)));
    if (!frame.length) break;
    box = { ...box };
    for (const { side, n } of frame) {
      if (side === "t") box.t += n; else if (side === "b") box.b -= n;
      else if (side === "l") box.l += n; else box.r -= n;
    }
    if (box.r - box.l < w * 0.5 || box.b - box.t < h * 0.5) return whole;
  }
  return box;
}

/** Average colour of a vertical strip of the box (the spine edge), as [r, g, b]. */
export function stripColor(px, w, box, from = 0, to = 0.08) {
  const x0 = box.l + Math.floor((box.r - box.l) * from);
  const x1 = Math.max(x0 + 1, box.l + Math.ceil((box.r - box.l) * to));
  const idx = [];
  for (let y = box.t; y < box.b; y++) for (let x = x0; x < x1; x++) idx.push((y * w + x) * 4);
  return mean(px, idx).map(Math.round);
}

// Cloth for books without a picture: dark, muted, and one cream.
export const CLOTH = [
  { bg: "#1C1E23", ink: "#E8E6E1" }, // graphite
  { bg: "#3B2124", ink: "#EFE2D6" }, // oxblood
  { bg: "#1E2B25", ink: "#E4E8DC" }, // forest
  { bg: "#1D2535", ink: "#E2E6EF" }, // navy
  { bg: "#30291F", ink: "#EDE3D1" }, // umber
  { bg: "#E6E0D2", ink: "#24221E" }, // cream
  { bg: "#2B2E35", ink: "#E7E8EB" }, // slate
];

const hash = (s) => {
  let x = 2166136261;
  for (const ch of String(s || "")) { x ^= ch.codePointAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
};

/** The cloth colour for a book without a picture; always the same for a title. */
export const clothFor = (title) => CLOTH[hash(String(title || "").trim().toLowerCase()) % CLOTH.length];

/**
 * How thick to draw a book, in px: from its pages, or roughly 30 pages per
 * chapter or module. Unknown length gets a middling book.
 */
export function bookThickness({ category, unit, total }) {
  if (!(total > 0)) return 14;
  const pages = category === "reading" && /^pages?$/i.test(unit || "pages") ? total : total * 30;
  return Math.round(Math.max(9, Math.min(26, 6 + Math.sqrt(pages) * 0.95)));
}

// ── In the browser ─────────────────────────────────────────────────────────

const SAMPLE = 180; // analysed at this size; plenty to find a margin
const MAX_W = 560;
const cache = new Map(); // src → info | "pending"
const listeners = new Set();
const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

const load = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

async function analyze(src) {
  const img = await load(src);
  const scale = Math.min(1, SAMPLE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const box = findFrame(px, w, h);
  const spine = stripColor(px, w, box);
  const trimmed = box.l > 0 || box.t > 0 || box.r < w || box.b < h;
  let out = src, cw = img.width, ch = img.height;
  if (trimmed) {
    // Back to the full picture, a little inside the margin so no line of it is left.
    const kx = img.width / w, ky = img.height / h;
    const sx = box.l > 0 ? (box.l + 0.75) * kx : 0, sy = box.t > 0 ? (box.t + 0.75) * ky : 0;
    const ex = box.r < w ? (box.r - 0.75) * kx : img.width, ey = box.b < h ? (box.b - 0.75) * ky : img.height;
    cw = ex - sx; ch = ey - sy;
    const s = Math.min(1, MAX_W / cw);
    const o = document.createElement("canvas");
    o.width = Math.round(cw * s); o.height = Math.round(ch * s);
    o.getContext("2d").drawImage(img, sx, sy, cw, ch, 0, 0, o.width, o.height);
    out = o.toDataURL("image/jpeg", 0.9);
  }
  const aspect = cw / ch;
  return { src: out, aspect, fit: coverFit(aspect), spine: rgb(spine) };
}

const notify = () => { for (const fn of listeners) fn(); };

/** Start looking at a cover (once); subscribers hear when it's ready. */
export function analyzeCover(src) {
  if (!src || cache.has(src)) return;
  cache.set(src, "pending");
  analyze(src)
    .catch(() => ({ src, aspect: 2 / 3, fit: "fill", spine: null }))
    .then((info) => {
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      cache.set(src, info);
      notify();
    });
}

/** What's known about a cover so far: info, or null while it's being looked at. */
export const peekCover = (src) => {
  const v = cache.get(src);
  return v && v !== "pending" ? v : null;
};

export const subscribeCovers = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** "rgb(r, g, b)" or "#rrggbb" → [r, g, b], or null. */
export function parseColor(c) {
  const s = String(c || "").trim();
  let m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(s);
  if (m) return [1, 2, 3].map(i => parseInt(m[i], 16));
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  return m ? [1, 2, 3].map(i => Math.min(255, Number(m[i]))) : null;
}

/** Text colour that reads on this background: a warm near-white on dark spines, a near-black on light ones. */
export function inkFor(bg) {
  const rgb = parseColor(bg);
  if (!rgb) return "#EDEAE3";
  const [r, g, b] = rgb.map(v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#1F1C17" : "#EDEAE3";
}

/** How tall a spine stands (px): books a little shorter than textbooks, each a touch different. */
export function spineHeight({ category, title }) {
  const h = hash(String(title || "").toLowerCase());
  return category === "reading" ? 150 + (h % 34) : 186 + (h % 22);
}
