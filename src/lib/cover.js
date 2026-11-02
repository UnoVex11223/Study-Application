// Covers on the shelf are shown as books (2:3, portrait), whatever shape the
// picture you added is.
//
// - A scan or screenshot often has a plain margin around the actual cover
//   (white paper, a page background). A margin of one colour on two or more
//   sides, ending at a clear edge, is cropped off. One band on its own is left
//   alone, since that's usually part of the design (a footer, a title strip).
// - Every picture fills the cover. One of another shape (a banner, a square
//   photo) is made 2:3 in one of two ways (coverPlan):
//   - extended, when the sides it's short of are plain (a background colour or
//     a soft gradient): those edges are carried on outward, so the whole
//     picture shows, title and all;
//   - cut, when they're busy: cut where it has the most detail, so lettering
//     and faces stay in, rather than just its middle.
//   The shelf form saves covers already made 2:3, with a cut where you dragged
//   it (lib/image.js, cutToBook).
// - A book without a picture gets a plain cloth cover in one of a few muted
//   colours, picked from its title so it always gets the same one.
//
// The pixel work is pure (and tested); analyzeCover runs it in the browser
// and caches the result per image, so a cover is only looked at once.

const BOOK = 2 / 3; // a cover's width / height

/** Whether a picture of this width / height is a book's shape already (within 3%). */
export const bookShaped = (aspect) => Math.abs(aspect / BOOK - 1) < 0.03;

/**
 * The book-shaped (2:3) part of a w×h picture, as { x, y, w, h }. `pos` says
 * where along the side with room to spare: 0 = left or top, 1 = right or bottom.
 */
export function coverWindow(w, h, pos = 0.5) {
  if (w / h > BOOK) { const cw = h * BOOK; return { x: (w - cw) * pos, y: 0, w: cw, h }; }
  const ch = w / BOOK;
  return { x: 0, y: (h - ch) * pos, w, h: ch };
}

const lum = (px, w, x, y) => { const i = (y * w + x) * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
/** How much a pixel differs from its neighbours to the right and below (detail: edges, lettering). */
const change = (px, w, x, y) => {
  const here = lum(px, w, x, y);
  return Math.abs(lum(px, w, x + 1, y) - here) + Math.abs(lum(px, w, x, y + 1) - here);
};

const EDGE = 0.04; // how deep into a side to look for detail, as a share of the picture
const PLAIN = 6;   // the most detail a side can have and still be carried on (mean change, 0–510)

/** How much detail there is along one side of the box (t, b, l or r), in its outer EDGE: 0 is flat colour. */
export function edgeDetail(px, w, box, side) {
  const deep = Math.max(2, Math.round((side === "t" || side === "b" ? box.b - box.t : box.r - box.l) * EDGE));
  const x0 = side === "r" ? box.r - deep : box.l, x1 = side === "l" ? box.l + deep : box.r;
  const y0 = side === "b" ? box.b - deep : box.t, y1 = side === "t" ? box.t + deep : box.b;
  let sum = 0, n = 0;
  for (let y = y0; y < y1 - 1; y++) for (let x = x0; x < x1 - 1; x++) { sum += change(px, w, x, y); n++; }
  return n ? sum / n : 0;
}

/**
 * How the part of a picture inside `box` is made to fill a cover:
 *   { fit: "fill" }             it's a book's shape already
 *   { fit: "extend", before }   its plain sides are carried on; `before` is the
 *                               share of the extra room above (or left of) it
 *   { fit: "cut", pos }         its sides are busy, so it's cut (see focusOf)
 */
export function coverPlan(px, w, h, box = { l: 0, t: 0, r: w, b: h }) {
  const bw = box.r - box.l, bh = box.b - box.t;
  if (bookShaped(bw / bh)) return { fit: "fill" };
  const [a, b] = bw / bh > BOOK ? ["t", "b"] : ["l", "r"];
  const plainA = edgeDetail(px, w, box, a) < PLAIN, plainB = edgeDetail(px, w, box, b) < PLAIN;
  if (plainA || plainB) return { fit: "extend", before: plainA && plainB ? 0.5 : plainA ? 1 : 0 };
  return { fit: "cut", pos: focusOf(px, w, h, box) };
}

/**
 * Where to cut a book-shaped window from a picture of another shape (the
 * `pos` for coverWindow): the stretch with the most detail in it (lettering,
 * faces, edges), leaning to the middle when it's close. A plain picture, or
 * one already book-shaped, is cut in the middle (0.5).
 */
export function focusOf(px, w, h, box = { l: 0, t: 0, r: w, b: h }) {
  const bw = box.r - box.l, bh = box.b - box.t;
  const wide = bw / bh > BOOK;
  const span = wide ? bw : bh;
  const size = Math.round(wide ? bh * BOOK : bw / BOOK);
  const room = span - size;
  if (room < 2) return 0.5;
  // Detail per column (or row).
  const detail = new Float64Array(span);
  for (let y = box.t; y < box.b - 1; y++) {
    for (let x = box.l; x < box.r - 1; x++) detail[wide ? x - box.l : y - box.t] += change(px, w, x, y);
  }
  let sum = 0;
  for (let i = 0; i < size; i++) sum += detail[i];
  let best = room / 2, bestScore = 0;
  for (let s = 0; s <= room; s++) {
    if (s > 0) sum += detail[s + size - 1] - detail[s - 1];
    const score = sum * (1 - 0.2 * Math.abs(s / room - 0.5)); // an end has to have a tenth more to win
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best / room;
}

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

// Cloth for books without a picture: the deep tones of the Kanagawa palette
// (the colour scheme the app is drawn in), and one paper-white.
export const CLOTH = [
  { bg: "#2A2A37", ink: "#DCD7BA" }, // sumi ink
  { bg: "#43242B", ink: "#E8D9C8" }, // winter red
  { bg: "#2B3328", ink: "#DCD7BA" }, // winter green
  { bg: "#223249", ink: "#DCD7BA" }, // wave blue
  { bg: "#49443C", ink: "#E6DDC4" }, // winter yellow
  { bg: "#DCD7BA", ink: "#1F1F28" }, // fuji white
  { bg: "#2D4F67", ink: "#E2E4DA" }, // deep wave
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

/**
 * The words split into k lines so the longest line is as short as it can be.
 * Returns { lines, longest } (longest in px, from measure).
 */
function splitLines(words, k, size, measure) {
  const n = words.length;
  const widths = new Map();
  const width = (i, j) => {
    const key = i * 64 + j;
    if (!widths.has(key)) widths.set(key, measure(words.slice(i, j).join(" "), size));
    return widths.get(key);
  };
  let best = null;
  const go = (from, left, lines, longest) => {
    if (best && longest >= best.longest) return;
    if (left === 1) {
      const w = Math.max(longest, width(from, n));
      if (!best || w < best.longest) best = { lines: [...lines, words.slice(from).join(" ")], longest: w };
      return;
    }
    for (let to = from + 1; to <= n - left + 1; to++) go(to, left - 1, [...lines, words.slice(from, to).join(" ")], Math.max(longest, width(from, to)));
  };
  go(0, Math.min(k, n), [], 0);
  return best;
}

/**
 * A title laid out to fit a strip of type (a spine, a book lying in a pile),
 * always in full, never cut short with "…".
 *   length   room along each line (px)
 *   across   room for the lines side by side (px)
 *   measure  (text, size) → its width in px at that font size
 * For one, two and three lines it finds the largest size (max down to min)
 * that fits; the biggest type wins, but each extra line has to earn its place
 * by being worth more than `perLine` px of type size. If even the smallest
 * doesn't fit, the title takes as many lines as it needs (up to four, then
 * smaller type) and `across` says how much room those lines need.
 * Returns { size, lines, across }.
 */
export function fitTitle(title, { length, across, max = 13, min = 7, leading = 1.12, perLine = 2, measure }) {
  const words = String(title || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length || length <= 0) return { size: max, lines: words.length ? [words.join(" ")] : [], across };
  let best = null;
  for (let k = 1; k <= Math.min(3, words.length); k++) {
    for (let size = Math.min(max, across / (k * leading)); size >= min - 1e-9; size -= 0.5) {
      const fit = splitLines(words, k, size, measure);
      if (fit.longest > length) continue;
      const score = size - perLine * (k - 1);
      if (!best || score > best.score) best = { score, size, lines: fit.lines };
      break;
    }
  }
  if (best) return { size: best.size, lines: best.lines, across };
  const most = Math.min(4, words.length);
  for (let k = 1; k <= most; k++) {
    const fit = splitLines(words, k, min, measure);
    if (fit.longest <= length || k === most) {
      const size = fit.longest > length ? Math.max(5, Math.floor((min * length / fit.longest) * 2) / 2) : min;
      return { size, lines: fit.lines, across: Math.max(across, Math.ceil(fit.lines.length * size * leading)) };
    }
  }
  return { size: min, lines: [words.join(" ")], across };
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
  const plan = coverPlan(px, w, h, box);
  const pos = plan.fit === "cut" ? plan.pos : 0.5;
  // The spine takes the colour of the left edge of the part that shows.
  const win = plan.fit === "cut" ? coverWindow(box.r - box.l, box.b - box.t, pos) : { x: 0, y: 0, w: box.r - box.l, h: box.b - box.t };
  const shown = { l: box.l + Math.floor(win.x), t: box.t + Math.floor(win.y), r: Math.min(box.r, box.l + Math.ceil(win.x + win.w)), b: Math.min(box.b, box.t + Math.ceil(win.y + win.h)) };
  const spine = rgb(stripColor(px, w, shown));
  const trimmed = box.l > 0 || box.t > 0 || box.r < w || box.b < h;
  if (!trimmed && plan.fit !== "extend") return { src, aspect: img.width / img.height, pos, spine };

  // Back to the full picture, a little inside any margin so no line of it is left.
  const kx = img.width / w, ky = img.height / h;
  const sx = box.l > 0 ? (box.l + 0.75) * kx : 0, sy = box.t > 0 ? (box.t + 0.75) * ky : 0;
  const ex = box.r < w ? (box.r - 0.75) * kx : img.width, ey = box.b < h ? (box.b - 0.75) * ky : img.height;
  const cw = ex - sx, ch = ey - sy;
  const wide = cw / ch > BOOK;
  // Extended: a 2:3 cover the picture's width (or height), the picture on it
  // and its plain sides stretched out from their last few lines to the edges.
  const W = plan.fit !== "extend" ? cw : wide ? cw : ch * BOOK;
  const H = plan.fit !== "extend" ? ch : wide ? cw / BOOK : ch;
  const s = Math.min(1, MAX_W / W);
  const o = document.createElement("canvas");
  o.width = Math.round(W * s); o.height = Math.round(H * s);
  const g = o.getContext("2d");
  if (plan.fit === "extend") {
    const pw = cw * s, ph = ch * s;
    const dx = wide ? 0 : (o.width - pw) * plan.before, dy = wide ? (o.height - ph) * plan.before : 0;
    const lines = 2 * (wide ? ky : kx); // two lines of the analysed picture
    if (wide) {
      g.drawImage(img, sx, sy, cw, lines, 0, 0, o.width, dy + 1);
      g.drawImage(img, sx, ey - lines, cw, lines, 0, dy + ph - 1, o.width, o.height - dy - ph + 1);
    } else {
      g.drawImage(img, sx, sy, lines, ch, 0, 0, dx + 1, o.height);
      g.drawImage(img, ex - lines, sy, lines, ch, dx + pw - 1, 0, o.width - dx - pw + 1, o.height);
    }
    g.drawImage(img, sx, sy, cw, ch, dx, dy, pw, ph);
  } else {
    g.drawImage(img, sx, sy, cw, ch, 0, 0, o.width, o.height);
  }
  return { src: o.toDataURL("image/jpeg", 0.9), aspect: W / H, pos, spine };
}

const notify = () => { for (const fn of listeners) fn(); };

/** Start looking at a cover (once); subscribers hear when it's ready. */
export function analyzeCover(src) {
  if (!src || cache.has(src)) return;
  cache.set(src, "pending");
  analyze(src)
    .catch(() => ({ src, aspect: BOOK, pos: 0.5, spine: null }))
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

/** What's known about a cover, once it's been looked at. */
export function coverInfo(src) {
  analyzeCover(src);
  const ready = peekCover(src);
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const off = subscribeCovers(() => { const info = peekCover(src); if (info) { off(); resolve(info); } });
  });
}

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
