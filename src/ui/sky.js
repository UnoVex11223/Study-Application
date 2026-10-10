// Pictures for the knowledge map's sky, painted once on small canvases and
// reused: suns for books, lit planets for concepts, and the starfield and
// Milky Way behind everything.
// Browser-only (uses canvas); everything is seeded, so the sky looks the same
// every visit.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hexRgb = (hex) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [200, 190, 160];
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgba = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const canvas = (w, h = w) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

// ── Suns ────────────────────────────────────────────────────────────────────
// Each book's star takes its course colour: a white-hot core, a surface that
// warms towards the colour at the edge (limb darkening), fine granulation, a
// soft corona, a bright bloom and diffraction spikes.

const sunCache = new Map();

/** { body, corona, bloom, spikes } canvases for a sun of this colour. */
export function sunSprites(color) {
  if (sunCache.has(color)) return sunCache.get(color);
  const tint = hexRgb(color);
  const white = [255, 252, 240];
  const warm = mix(tint, [255, 214, 150], 0.62);
  const rim = mix(tint, [150, 70, 30], 0.35);

  // Body: 256px, radius 120 (the rest is a thin halo).
  const body = canvas(256);
  let g = body.getContext("2d");
  const R = 112, C = 128;
  let grad = g.createRadialGradient(C - 18, C - 22, 4, C, C, R);
  grad.addColorStop(0, rgba(white));
  grad.addColorStop(0.35, rgba(mix(white, warm, 0.35)));
  grad.addColorStop(0.75, rgba(warm));
  grad.addColorStop(1, rgba(rim));
  g.fillStyle = grad;
  g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.fill();
  // Granulation: faint light and dark cells over the surface.
  g.save();
  g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.clip();
  const rand = rng(hexRgb(color).reduce((n, v) => n * 31 + v, 7));
  for (let i = 0; i < 520; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * R;
    const x = C + Math.cos(a) * d, y = C + Math.sin(a) * d, r = 2 + rand() * 6;
    g.fillStyle = rand() < 0.55 ? `rgba(255, 250, 235, ${0.05 + rand() * 0.07})` : rgba(rim, 0.05 + rand() * 0.08);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Limb darkening on top of the texture.
  grad = g.createRadialGradient(C, C, R * 0.55, C, C, R);
  grad.addColorStop(0, "rgba(0, 0, 0, 0)");
  grad.addColorStop(1, rgba(mix(rim, [40, 15, 5], 0.4), 0.45));
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.restore();
  // A thin bright edge.
  grad = g.createRadialGradient(C, C, R * 0.96, C, C, R * 1.12);
  grad.addColorStop(0, rgba(mix(warm, white, 0.5), 0.5));
  grad.addColorStop(1, rgba(warm, 0));
  g.fillStyle = grad;
  g.beginPath(); g.arc(C, C, R * 1.12, 0, Math.PI * 2); g.fill();

  // Corona: a wide soft glow.
  const corona = canvas(256);
  g = corona.getContext("2d");
  grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, rgba(mix(white, warm, 0.3), 0.55));
  grad.addColorStop(0.18, rgba(warm, 0.32));
  grad.addColorStop(0.42, rgba(tint, 0.12));
  grad.addColorStop(1, rgba(tint, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);

  // Bloom: the bright glare right around the disc, drawn additively over
  // everything near the sun (planets passing close are washed out a little).
  const bloom = canvas(256);
  g = bloom.getContext("2d");
  grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, rgba(white, 0.9));
  grad.addColorStop(0.12, rgba(mix(white, warm, 0.25), 0.55));
  grad.addColorStop(0.3, rgba(warm, 0.16));
  grad.addColorStop(0.6, rgba(tint, 0.04));
  grad.addColorStop(1, rgba(tint, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);

  // Diffraction spikes, like a bright star in a telescope photo: four long
  // thin ones and four short faint ones between them. They don't turn.
  const spikes = canvas(512);
  g = spikes.getContext("2d");
  g.translate(256, 256);
  for (let i = 0; i < 8; i++) {
    const long = i % 2 === 0, len = long ? 250 : 110, w = long ? 1.6 : 1.1;
    g.save();
    g.rotate((i * Math.PI) / 4);
    const lg = g.createLinearGradient(0, 0, len, 0);
    lg.addColorStop(0, rgba(mix(white, warm, 0.2), long ? 0.75 : 0.32));
    lg.addColorStop(0.25, rgba(mix(white, warm, 0.5), long ? 0.28 : 0.1));
    lg.addColorStop(1, rgba(tint, 0));
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w); g.closePath(); g.fill();
    g.restore();
  }
  const out = { body, corona, bloom, spikes };
  sunCache.set(color, out);
  return out;
}


// ── Planets ─────────────────────────────────────────────────────────────────
// A concept is a small planet lit by its book's sun. The body (colour, faint
// cloud bands, darker towards the edge) keeps still; the shading on top
// (a lit side with a thin bright rim, a dark night side) is turned to face
// the sun as the planet goes round, so it waxes and wanes like a moon.

/** A course colour nudged a little in hue and brightness, so planets in one system aren't all identical. */
export function varyColor(hex, r) {
  const [h, sat, l] = rgbToHsl(hexRgb(hex));
  const v = Math.floor(r * 5) / 4 - 0.5;            // five steps, -0.5 … 0.5
  return hslToHex((h + v * 26 + 360) % 360, Math.min(1, sat * (1 + v * 0.25)), Math.max(0.2, Math.min(0.8, l + v * 0.08)));
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

export const PLANET_SPRITE = 64;   // sprite size
export const PLANET_R = 26;        // the planet's radius inside it

const bodyCache = new Map();
/**
 * The body of a planet, unlit. kind: "bright" (mastered), "lit" (being
 * learned), "slipping", "dark" (not started: a dim world with only its rim
 * catching the light) or "dust" (in a chapter you haven't read).
 */
export function planetBody(color, kind) {
  const key = `${color}|${kind}`;
  if (bodyCache.has(key)) return bodyCache.get(key);
  const S = PLANET_SPRITE, C = S / 2, R = PLANET_R;
  const base = kind === "slipping" ? [242, 166, 90] : kind === "dust" ? [118, 116, 120] : hexRgb(color);
  const body = kind === "dark" ? mix(base, [18, 21, 30], 0.78) : kind === "lit" ? mix(base, [150, 156, 172], 0.18) : base;
  const c = canvas(S);
  const g = c.getContext("2d");
  g.save();
  g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = rgba(body);
  g.fillRect(0, 0, S, S);
  // Cloud bands, faint, a little tilted.
  const rand = rng(hexRgb(color).reduce((n, v) => n * 31 + v, kind.length));
  for (let i = 0; i < 7; i++) {
    const y = C + (rand() - 0.5) * R * 1.8, hh = R * (0.05 + rand() * 0.16);
    g.fillStyle = rgba(rand() < 0.5 ? mix(body, [255, 255, 255], 0.35) : mix(body, [0, 0, 0], 0.35), kind === "dust" ? 0.05 : 0.13);
    g.beginPath(); g.ellipse(C, y, R * 1.3, hh, -0.12 + rand() * 0.08, 0, Math.PI * 2); g.fill();
  }
  // Darker towards the edge, like any lit sphere.
  const edge = g.createRadialGradient(C, C, R * 0.35, C, C, R);
  edge.addColorStop(0, "rgba(0, 0, 0, 0)");
  edge.addColorStop(1, "rgba(0, 0, 0, 0.42)");
  g.fillStyle = edge;
  g.fillRect(0, 0, S, S);
  g.restore();
  // Not started: a faint outline, so dark worlds can still be found.
  if (kind === "dark") {
    g.strokeStyle = rgba(base, 0.5);
    g.lineWidth = 1.6;
    g.beginPath(); g.arc(C, C, R - 0.8, 0, Math.PI * 2); g.stroke();
  }
  bodyCache.set(key, c);
  return c;
}

let shadeSprite = null;
/** Light and shadow for any planet, lit from the left; turn it to face the sun. */
export function planetShade() {
  if (shadeSprite) return shadeSprite;
  const S = PLANET_SPRITE, C = S / 2, R = PLANET_R;
  const c = canvas(S);
  const g = c.getContext("2d");
  g.save();
  g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.clip();
  // The day side: a soft highlight towards the sun.
  let gr = g.createRadialGradient(C - R * 0.55, C - R * 0.12, 0, C - R * 0.4, C, R * 1.05);
  gr.addColorStop(0, "rgba(255, 252, 240, .5)");
  gr.addColorStop(0.5, "rgba(255, 250, 235, .12)");
  gr.addColorStop(1, "rgba(255, 250, 235, 0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  // The night side.
  gr = g.createLinearGradient(C - R, 0, C + R, 0);
  gr.addColorStop(0, "rgba(2, 3, 8, 0)");
  gr.addColorStop(0.5, "rgba(2, 3, 8, 0.05)");
  gr.addColorStop(0.78, "rgba(2, 3, 8, 0.78)");
  gr.addColorStop(1, "rgba(2, 3, 8, 0.94)");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  g.restore();
  // A thin bright rim where the sunlight grazes the edge (an atmosphere).
  gr = g.createLinearGradient(C - R, 0, C + R * 0.15, 0);
  gr.addColorStop(0, "rgba(255, 250, 235, .85)");
  gr.addColorStop(1, "rgba(255, 250, 235, 0)");
  g.strokeStyle = gr;
  g.lineWidth = 2;
  g.beginPath(); g.arc(C, C, R - 1, Math.PI * 0.5, Math.PI * 1.5); g.stroke();
  shadeSprite = c;
  return c;
}

// ── Starfield ───────────────────────────────────────────────────────────────

const STAR_COLORS = [
  [[255, 255, 255], 0.56], [[214, 226, 255], 0.2], [[255, 244, 220], 0.12],
  [[255, 214, 170], 0.07], [[170, 196, 255], 0.05],
];
function starColor(r) {
  let acc = 0;
  for (const [c, w] of STAR_COLORS) { acc += w; if (r < acc) return c; }
  return STAR_COLORS[0][0];
}

/** A small star with a glow and, for the brightest, four thin spikes. */
function paintStar(g, x, y, r, color, alpha, spikes) {
  if (r > 1.25) {
    const glowR = r * 5;
    const gg = g.createRadialGradient(x, y, 0, x, y, glowR);
    gg.addColorStop(0, rgba(color, 0.2 * alpha));
    gg.addColorStop(1, rgba(color, 0));
    g.fillStyle = gg;
    g.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
  }
  if (spikes) {
    const len = r * 11;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const lg = g.createLinearGradient(x - dx * len, y - dy * len, x + dx * len, y + dy * len);
      lg.addColorStop(0, rgba(color, 0));
      lg.addColorStop(0.5, rgba(color, 0.45 * alpha));
      lg.addColorStop(1, rgba(color, 0));
      g.strokeStyle = lg;
      g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x - dx * len, y - dy * len); g.lineTo(x + dx * len, y + dy * len); g.stroke();
    }
  }
  g.fillStyle = rgba(color, alpha);
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

const tileCache = new Map();
/**
 * A seamless square of stars, as a data URL for a repeating background.
 * Most stars are faint pinpricks; a few are bright, with a glow, and the
 * brightest have diffraction spikes (like in a telescope photo).
 */
export function starTile(size, count, seed, { bright = 1, spikes = true } = {}) {
  const key = `${size}|${count}|${seed}|${bright}|${spikes}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const c = canvas(size);
  const g = c.getContext("2d");
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = rand() * size, y = rand() * size;
    const m = Math.pow(rand(), 5.5);            // magnitude: almost all faint
    const r = (0.28 + m * 1.9) * bright;
    const alpha = Math.min(1, 0.3 + m * 0.9 + rand() * 0.25);
    const color = starColor(rand());
    const spike = spikes && m > 0.8;
    // Draw across the edges too, so the tile repeats without seams.
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const px = x + ox, py = y + oy;
      if (px < -30 || py < -30 || px > size + 30 || py > size + 30) continue;
      paintStar(g, px, py, r, color, alpha, spike);
    }
  }
  const url = `url("${c.toDataURL("image/png")}")`;
  tileCache.set(key, url);
  return url;
}

/**
 * The Milky Way: a soft diagonal band of dust and faint stars with a few
 * coloured clouds, painted to fit the map (it drifts only slightly, so it
 * doesn't need to repeat).
 */
export function paintGalaxy(cv, w, h, dpr = 1) {
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const rand = rng(90210);
  // The band runs from lower left to upper right.
  const ang = -0.42, cos = Math.cos(ang), sin = Math.sin(ang);
  const cx = w * 0.5, cy = h * 0.52, len = Math.hypot(w, h) * 0.75, width = Math.min(w, h) * 0.2;
  const along = (t, off) => [cx + cos * t - sin * off, cy + sin * t + cos * off];
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;

  // Glow of the band.
  g.save();
  g.translate(cx, cy);
  g.rotate(ang);
  const band = g.createLinearGradient(0, -width * 1.6, 0, width * 1.6);
  band.addColorStop(0, "rgba(120, 130, 190, 0)");
  band.addColorStop(0.5, "rgba(140, 150, 205, 0.075)");
  band.addColorStop(1, "rgba(120, 130, 190, 0)");
  g.fillStyle = band;
  g.fillRect(-len, -width * 1.6, len * 2, width * 3.2);
  g.restore();

  // Clouds: blue, violet, teal and a little rose along the band.
  const tones = [[98, 120, 220], [150, 110, 210], [80, 170, 190], [210, 120, 160], [120, 140, 230]];
  for (let i = 0; i < 26; i++) {
    const [x, y] = along((rand() - 0.5) * len * 1.6, gauss() * width * 0.9);
    const r = width * (0.35 + rand() * 0.9);
    const c = tones[Math.floor(rand() * tones.length)];
    const cg = g.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(0, rgba(c, 0.05 + rand() * 0.06));
    cg.addColorStop(1, rgba(c, 0));
    g.fillStyle = cg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Two wispy nebulae away from the band: soft clouds strung along a
  // wandering path, so they read as filaments rather than round blobs.
  for (const [fx, fy, tone, steps] of [[0.16, 0.22, [120, 150, 230], 70], [0.84, 0.8, [200, 110, 150], 60]]) {
    let x = w * fx, y = h * fy, dir = rand() * Math.PI * 2;
    for (let i = 0; i < steps; i++) {
      dir += (rand() - 0.5) * 0.9;
      x += Math.cos(dir) * width * 0.06;
      y += Math.sin(dir) * width * 0.06;
      const r = width * (0.12 + rand() * 0.3);
      const ng = g.createRadialGradient(x, y, 0, x, y, r);
      ng.addColorStop(0, rgba(mix(tone, [255, 255, 255], rand() * 0.3), 0.01 + rand() * 0.02));
      ng.addColorStop(1, rgba(tone, 0));
      g.fillStyle = ng;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  // Dark dust lanes through the middle.
  for (let i = 0; i < 14; i++) {
    const [x, y] = along((rand() - 0.5) * len * 1.4, gauss() * width * 0.25);
    const r = width * (0.2 + rand() * 0.4);
    const dg = g.createRadialGradient(x, y, 0, x, y, r);
    dg.addColorStop(0, "rgba(5, 6, 11, .28)");
    dg.addColorStop(1, "rgba(5, 6, 11, 0)");
    g.fillStyle = dg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Thousands of faint stars crowding the band.
  const n = Math.round((w * h) / 260);
  for (let i = 0; i < n; i++) {
    const [x, y] = along((rand() - 0.5) * len * 1.7, gauss() * width * (rand() < 0.8 ? 0.8 : 1.8));
    const a = 0.12 + rand() * 0.45;
    g.fillStyle = rgba(starColor(rand()), a);
    g.fillRect(x, y, rand() < 0.9 ? 0.8 : 1.3, rand() < 0.9 ? 0.8 : 1.3);
  }
}
