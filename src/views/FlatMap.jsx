// The knowledge map in 2D: every book is a star with its name beneath it, its
// chapters are orbits and its concepts are planets going round (see
// lib/orbits.js). Planets are lit by their own sun, so they wax and wane as
// they go round. Links between books are drawn as one soft stream between
// their suns; a planet's own links appear when you point at it. Names come in
// as you zoom in. A single course can also be shown as its prerequisite chart.
//
// Drawn on a canvas: hundreds of moving planets and links redraw in a couple
// of milliseconds, where SVG would repaint the whole map on every frame.
// React only re-renders when the view or the selected concept changes.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { useNav } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import ConceptPanel from "./ConceptPanel.jsx";
import { transition } from "../ui/motion.js";
import { index } from "../lib/model.js";
import { conceptMastery } from "../lib/mastery.js";
import { layeredLayout } from "../lib/graph.js";
import { orbitalLayout, planetAt, systemBounds, TILT, seeded, bridgesBetween, bow, onCurve, fadeIn } from "../lib/orbits.js";
import { sunSprites, starTile, paintGalaxy, planetBody, planetShade, varyColor, PLANET_SPRITE, PLANET_R } from "../ui/sky.js";

const RADIUS = { core: 6.4, supporting: 4.8, detail: 3.7 };
const SLIPPING = "#F2A65A";
const MAX_LABEL = 30;
const short = (n) => (n.length > MAX_LABEL ? `${n.slice(0, MAX_LABEL - 1)}…` : n);
const stillPreferred = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// The starfield: three layers of stars at different depths (they drift at
// different speeds as you move), the Milky Way behind them, and a faint
// colour wash. Painted once per session and reused.
let tiles = null;
const starTiles = () => (tiles ||= {
  far: starTile(640, 420, 11, { bright: 0.7, spikes: false }),
  near: starTile(900, 70, 23, { bright: 1 }),
  twinkle: starTile(700, 40, 37, { bright: 0.9, spikes: false }),
});
const NEBULA = [
  "radial-gradient(ellipse 60% 45% at 18% 28%, rgba(111, 127, 212, .12), transparent 70%)",
  "radial-gradient(ellipse 50% 40% at 82% 72%, rgba(162, 134, 204, .1), transparent 70%)",
  "radial-gradient(ellipse 45% 35% at 62% 12%, rgba(94, 162, 191, .07), transparent 70%)",
];

function hexToRgb(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || "");
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : "160, 170, 200";
}

function withAlpha(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || "");
  if (!m) return `rgba(160, 170, 200, ${a})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

// Soft glows, drawn once per colour and reused as images (much cheaper than blur).
const glowCache = new Map();
function glow(color) {
  if (glowCache.has(color)) return glowCache.get(color);
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, withAlpha(color, 0.62));
  grad.addColorStop(0.35, withAlpha(color, 0.22));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowCache.set(color, c);
  return c;
}

/** How a planet looks for its mastery status (see planetBody in ui/sky.js). */
function planetKind(status, locked) {
  if (locked) return "dust";
  if (status === "mastered") return "bright";
  if (status === "slipping") return "slipping";
  if (status === "learning" || status === "practiced") return "lit";
  return "dark";
}

// The flat map: the Prerequisites chart for a course, and the whole sky drawn
// in 2D on computers that can't show the 3D one (see SkyMap.jsx). onView tells
// the map page when you switch course or view, so it can swap the 3D sky back in.
export default function FlatMap({ focusCourseId, focusConceptId, initialScope, initialMode = "orbits", onView }) {
  const { state } = useStore();
  const nav = useNav();
  const ix = index(state);
  const [scope, setScopeState] = useState(initialScope ?? focusCourseId ?? "all");
  const [mode, setModeState] = useState(initialMode);
  const setScope = (v) => { setScopeState(v); onView?.({ scope: v, mode: v === "all" ? "orbits" : mode }); };
  const setMode = (v) => { setModeState(v); onView?.({ scope, mode: v }); };
  const [selected, setSelected] = useState(focusConceptId ?? null);

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const spaceRef = useRef(null);
  const twinkleRef = useRef(null);
  const galaxyRef = useRef(null);
  const sceneRef = useRef(null);
  const cam = useRef({ x: 0, y: 0, k: 1 });
  const camAnim = useRef(null);         // { from, to (a view, or a function giving one), t0, ms }
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const dirty = useRef(true);
  const fitted = useRef(false);
  const drag = useRef(null);
  const hover = useRef(null);           // concept highlighted by the pointer (after a short pause)
  const pointerOn = useRef(null);       // concept under the pointer right now
  const hoverTimer = useRef(0);
  const selectedRef = useRef(selected);
  const focusFade = useRef({ id: null, mix: 0 });
  const clock = useRef({ t: null, speed: 1, hold: Boolean(focusConceptId) });
  const orbitTime = () => {
    const c = clock.current;
    if (c.t == null) c.t = (Date.now() / 1000) % 1e5; // from the real clock: the sky isn't the same every visit
    return c.t;
  };

  const prereqMode = scope !== "all" && mode === "prereq";

  // ── What to draw ───────────────────────────────────────────────────────
  const concepts = useMemo(
    () => state.concepts.filter(c => !c.suspended && (scope === "all" || c.courseId === scope)),
    [state.concepts, scope],
  );
  const orbit = useMemo(() => (prereqMode ? null : orbitalLayout({
    courses: state.courses.filter(c => scope === "all" || c.id === scope),
    sections: state.sections,
    concepts,
  })), [prereqMode, state.courses, state.sections, concepts, scope]);
  const staticPos = useMemo(() => {
    if (!prereqMode) return null;
    const prereqs = state.edges.filter(e => e.type === "prereq").map(e => ({ from: e.from, to: e.to }));
    return layeredLayout(concepts.map(c => ({ id: c.id })), prereqs).pos;
  }, [prereqMode, state.edges, concepts]);

  const scene = useMemo(() => {
    const planets = [];
    for (const c of concepts) {
      const o = orbit?.planets[c.id], f = staticPos?.[c.id];
      if (!o && !f) continue;
      const color = varyColor(ix.course[c.courseId]?.color || "#8A93A6", seeded(c.id, 3));
      const kind = planetKind(conceptMastery(state, c.id).status, ix.lockedConcepts.has(c.id));
      planets.push({
        id: c.id, courseId: c.courseId, name: short(c.name), core: c.importance === "core",
        r: RADIUS[c.importance] ?? 5, orbit: o || null, fixed: f || null, x: f?.x ?? 0, y: f?.y ?? 0, depth: 0,
        sx: o?.sx ?? 0, sy: o?.sy ?? 0, color, kind,
        halo: kind === "bright" ? color : kind === "slipping" ? SLIPPING : null, pulse: kind === "slipping",
        ring: c.importance === "core" && kind !== "dust" ? `rgba(${hexToRgb(color)}, .5)` : null,
      });
    }
    const byId = new Map(planets.map(p => [p.id, p]));
    const adj = new Map();
    const links = [];
    for (const e of state.edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) continue;
      links.push({ a, b, cross: a.courseId !== b.courseId, prereq: e.type === "prereq", provisional: (e.confidence ?? 1) < 0.6 });
      if (!adj.has(a.id)) adj.set(a.id, new Set());
      if (!adj.has(b.id)) adj.set(b.id, new Set());
      adj.get(a.id).add(b.id);
      adj.get(b.id).add(a.id);
    }
    // Each book is a sun, a little bigger the more it holds.
    const perSystem = new Map();
    for (const p of planets) perSystem.set(p.courseId, (perSystem.get(p.courseId) || 0) + 1);
    const systems = (orbit?.systems || []).map(sys => ({ ...sys, sunR: 15 + Math.min(13, Math.sqrt(perSystem.get(sys.id) || 1) * 1.6) }));
    // One stream of light between each pair of books with links, with motes drifting along it.
    const sysById = new Map(systems.map(x => [x.id, x]));
    const bridges = bridgesBetween(links.filter(l => l.cross).map(l => ({ a: l.a.courseId, b: l.b.courseId })))
      .filter(br => sysById.has(br.a) && sysById.has(br.b))
      .map(br => {
        const key = `${br.a}|${br.b}`;
        const motes = Array.from({ length: Math.min(40, 12 + br.n) }, (_, i) => ({
          u0: seeded(key, i * 7 + 1), speed: 0.006 + seeded(key, i * 7 + 2) * 0.01,
          off: seeded(key, i * 7 + 3) - 0.5, a: 0.3 + seeded(key, i * 7 + 4) * 0.6, size: 0.8 + seeded(key, i * 7 + 5) * 1.6,
        }));
        return { ...br, from: sysById.get(br.a), to: sysById.get(br.b), motes, bend: seeded(key) < 0.5 ? 0.1 : -0.1,
          strength: Math.min(1, 0.45 + br.n / 40) };
      });
    return { planets, byId, links, adj, systems, bridges, prereqMode, sky: scope === "all", few: planets.length <= 40 };
  }, [concepts, orbit, staticPos, state, ix, scope, prereqMode]);

  const bounds = useMemo(() => {
    if (!prereqMode) return systemBounds(orbit?.systems || []);
    const ps = Object.values(staticPos || {});
    if (!ps.length) return { x0: -100, y0: -100, x1: 100, y1: 100 };
    return { x0: Math.min(...ps.map(p => p.x)) - 100, x1: Math.max(...ps.map(p => p.x)) + 160, y0: Math.min(...ps.map(p => p.y)) - 70, y1: Math.max(...ps.map(p => p.y)) + 90 };
  }, [prereqMode, orbit, staticPos]);

  useLayoutEffect(() => { sceneRef.current = scene; dirty.current = true; }, [scene]);
  useEffect(() => {
    selectedRef.current = selected;
    clock.current.hold = Boolean(selected) || Boolean(pointerOn.current);
    dirty.current = true;
  }, [selected]);

  // ── Camera ─────────────────────────────────────────────────────────────
  const setCam = useCallback((v) => {
    cam.current = v;
    dirty.current = true;
    // The stars drift a little as you move: far ones less than near ones.
    if (spaceRef.current) spaceRef.current.style.backgroundPosition = `${v.x * 0.02}px ${v.y * 0.02}px, ${v.x * 0.07}px ${v.y * 0.07}px, 0 0, 0 0, 0 0`;
    if (twinkleRef.current) twinkleRef.current.style.backgroundPosition = `${v.x * 0.045}px ${v.y * 0.045}px`;
    const g = galaxyRef.current;
    if (g) {
      const { w, h } = size.current;
      const clamp = (n, m) => Math.max(-m, Math.min(m, n));
      g.style.transform = `translate(${clamp(v.x * 0.012, w * 0.05)}px, ${clamp(v.y * 0.012, h * 0.05)}px)`;
    }
  }, []);
  /** Glide the camera; the target can be a function, to follow a moving planet. */
  const glideTo = useCallback((to, ms = 560) => {
    if (stillPreferred()) { setCam(typeof to === "function" ? to() : to); camAnim.current = null; return; }
    camAnim.current = { from: { ...cam.current }, to, t0: performance.now(), ms };
  }, [setCam]);
  const viewFor = useCallback((b, maxK = 1.4) => {
    const { w, h } = size.current;
    if (!w || !h) return null;
    const k = Math.min(maxK, Math.max(0.12, Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0)) * 0.94));
    return { k, x: w / 2 - ((b.x0 + b.x1) / 2) * k, y: h / 2 - ((b.y0 + b.y1) / 2) * k };
  }, []);
  const fit = () => { const v = viewFor(bounds); if (v) glideTo(v, 480); };
  const focusSystem = useCallback((s) => {
    const v = viewFor({ x0: s.x - s.radius, x1: s.x + s.radius, y0: s.y - s.radius * TILT - 30, y1: s.y + s.radius * TILT + 30 }, 2);
    if (v) glideTo(v, 750);
  }, [viewFor, glideTo]);

  /** Bring a planet to the middle of what's left beside the panel, following it as the sky slows. */
  const centerOn = useCallback((id) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const panel = Math.min(520, window.innerWidth * 0.92) + 20;
    const visible = Math.min(r.width, Math.max(r.width * 0.4, window.innerWidth - panel - r.left));
    const k = Math.min(1.8, Math.max(cam.current.k, 1.2));
    glideTo(() => {
      const p = sceneRef.current?.byId.get(id);
      if (!p) return cam.current;
      const q = p.orbit ? planetAt(p.orbit, orbitTime()) : p.fixed;
      return { k, x: visible / 2 - q.x * k, y: r.height / 2 - q.y * k };
    }, 820);
  }, [glideTo]);
  // Opening a planet grows it into its panel: a small lit disc is put where the
  // planet is, and a "sheet" view transition (ui/motion.js) morphs it into the
  // panel. With the panel already open, the panel just changes.
  const choose = useCallback((id) => {
    const p = sceneRef.current?.byId.get(id);
    const canvas = canvasRef.current;
    if (!selectedRef.current && p && canvas) {
      const r = canvas.getBoundingClientRect(), { x, y, k } = cam.current;
      const rad = Math.max(7, p.r * k * 1.5);
      const ghost = document.createElement("div");
      ghost.className = "planet-ghost";
      Object.assign(ghost.style, {
        left: `${r.left + p.x * k + x - rad}px`, top: `${r.top + p.y * k + y - rad}px`, width: `${rad * 2}px`, height: `${rad * 2}px`,
        background: `radial-gradient(circle at 36% 36%, #fff 0, ${p.color} 38%, ${withAlpha(p.color, 0.35)} 62%, transparent 72%)`,
        viewTransitionName: "sheet",
      });
      document.body.appendChild(ghost);
      transition(() => { ghost.remove(); setSelected(id); }, "sheet");
    } else setSelected(id);
    clock.current.hold = true;
    centerOn(id);
  }, [centerOn]);

  // Fit the view when what's shown changes (once the canvas has a size).
  useEffect(() => {
    fitted.current = false;
    const v = viewFor(bounds);
    if (v) { setCam(v); fitted.current = true; }
  }, [bounds, viewFor, setCam]);
  useEffect(() => {
    if (!focusConceptId) return undefined;
    const t = setTimeout(() => centerOn(focusConceptId), 220);
    return () => clearTimeout(t);
  }, [focusConceptId, centerOn]);

  // ── Size ───────────────────────────────────────────────────────────────
  const hasPlanets = scene.planets.length > 0;
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return undefined;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      if (galaxyRef.current) paintGalaxy(galaxyRef.current, r.width * 1.1, r.height * 1.1, Math.min(1.5, dpr));
      if (!fitted.current) { const v = viewFor(bounds); if (v) { setCam(v); fitted.current = true; } }
      dirty.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [bounds, viewFor, setCam, hasPlanets]);

  // ── Drawing ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";
    const serif = getComputedStyle(document.documentElement).getPropertyValue("--serif").trim() || "serif";
    const still = stillPreferred();
    let raf = 0, last = performance.now(), drawnAt = 0;

    const draw = (now) => {
      const s = sceneRef.current;
      const { w, h, dpr } = size.current;
      if (!s || !w) return;
      const { x: cx, y: cy, k } = cam.current;
      const t = orbitTime();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * cx, dpr * cy);

      for (const p of s.planets) {
        if (!p.orbit) continue;
        const q = planetAt(p.orbit, t);
        p.x = q.x; p.y = q.y; p.depth = q.depth;
      }
      const fade = focusFade.current;
      const focusId = fade.id;
      const near = focusId ? s.adj.get(focusId) : null;
      const isNear = (id) => id === focusId || Boolean(near?.has(id));
      const dimA = 1 - 0.82 * fade.mix; // alpha for everything away from the focus
      const px = 1 / k;                 // one screen pixel, in map units
      const holdsFocus = (sys) => !focusId || s.planets.some(p => p.courseId === sys.id && isNear(p.id));

      // Suns' coronas first: the glow everything else sits in.
      const secs = now / 1000;
      const breathe = still ? 1 : 1 + 0.035 * Math.sin(secs * (2 * Math.PI / 7));
      const sysAlpha = (sys) => (holdsFocus(sys) ? 1 : 1 - 0.6 * fade.mix);
      ctx.globalCompositeOperation = "lighter";
      for (const sys of s.systems) {
        const R = sys.sunR * 5.4 * breathe;
        ctx.globalAlpha = sysAlpha(sys) * 0.8;
        ctx.drawImage(sunSprites(sys.color).corona, sys.x - R, sys.y - R, R * 2, R * 2);
      }
      ctx.globalCompositeOperation = "source-over";

      // Orbits: hairlines, the near half a little brighter than the far half;
      // a chapter you haven't read is fainter; the focused planet's orbit is lit.
      const focusP = focusId ? s.byId.get(focusId) : null;
      ctx.lineWidth = px;
      ctx.strokeStyle = "rgb(205, 214, 240)";
      for (const sys of s.systems) {
        const sa = sysAlpha(sys);
        sys.rings.forEach((ring, i) => {
          const lit = focusP && focusP.orbit && focusP.courseId === sys.id && focusP.orbit.ring === i;
          const base = (ring.locked ? 0.04 : 0.085) + (lit ? 0.16 * fade.mix : 0);
          ctx.globalAlpha = sa * base * 0.45;
          ctx.beginPath(); ctx.ellipse(sys.x, sys.y, ring.r, ring.r * TILT, 0, Math.PI, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = sa * base;
          ctx.beginPath(); ctx.ellipse(sys.x, sys.y, ring.r, ring.r * TILT, 0, 0, Math.PI); ctx.stroke();
        });
      }

      // Streams between books: a soft band from sun to sun, with motes of light drifting along it.
      if (s.sky && s.bridges.length) {
        ctx.globalCompositeOperation = "lighter";
        const ba = 1 - 0.7 * fade.mix;
        for (const br of s.bridges) {
          const A = br.from, B = br.to;
          const d = Math.hypot(B.x - A.x, B.y - A.y) || 1, ux = (B.x - A.x) / d, uy = (B.y - A.y) / d;
          const ax = A.x + ux * A.sunR * 2.4, ay = A.y + uy * A.sunR * 2.4, bx = B.x - ux * B.sunR * 2.4, by = B.y - uy * B.sunR * 2.4;
          const c = bow(ax, ay, bx, by, br.bend);
          const grad = ctx.createLinearGradient(ax, ay, bx, by);
          grad.addColorStop(0, withAlpha(A.color, 0));
          grad.addColorStop(0.18, withAlpha(A.color, 1));
          grad.addColorStop(0.5, "rgba(214, 222, 255, 1)");
          grad.addColorStop(0.82, withAlpha(B.color, 1));
          grad.addColorStop(1, withAlpha(B.color, 0));
          ctx.strokeStyle = grad;
          ctx.lineCap = "round";
          for (const [wd, al] of [[70, 0.014], [32, 0.026], [12, 0.045], [2.4, 0.08]]) {
            ctx.globalAlpha = ba * br.strength * al;
            ctx.lineWidth = wd;
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(c.x, c.y, bx, by); ctx.stroke();
          }
          const nx = -uy, ny = ux;
          for (const m of br.motes) {
            const u = still ? m.u0 : (m.u0 + secs * m.speed) % 1;
            const q = onCurve(ax, ay, c, bx, by, u);
            const spread = Math.sin(Math.PI * u) * 22 * m.off;
            const sz = m.size * 3.2 * Math.max(px, 0.6);
            ctx.globalAlpha = ba * m.a * Math.pow(Math.sin(Math.PI * u), 1.4);
            ctx.drawImage(glow("#DCE3FF"), q.x + nx * spread - sz, q.y + ny * spread - sz, sz * 2, sz * 2);
          }
        }
        ctx.lineCap = "butt";
        ctx.globalCompositeOperation = "source-over";
      }

      // Links between planets, as gentle arcs: inside a system they swing out
      // around its sun. Only the focused planet's links in the all-books view;
      // in one course, faintly, all of them.
      const arc = (l) => {
        if (s.prereqMode) {
          const ax = l.a.x + l.a.r + 2, bx = l.b.x - l.b.r - 3, mx = (l.a.x + l.b.x) / 2;
          ctx.moveTo(ax, l.a.y);
          ctx.bezierCurveTo(mx, l.a.y, mx, l.b.y, bx, l.b.y);
          return;
        }
        const mx = (l.a.x + l.b.x) / 2, my = (l.a.y + l.b.y) / 2;
        let c;
        if (l.cross) c = bow(l.a.x, l.a.y, l.b.x, l.b.y, 0.1);
        else {
          // Like a transfer orbit: swing out around the sun, not across it.
          const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, ch = Math.hypot(dx, dy) || 1;
          let ox = mx - l.a.sx, oy = my - l.a.sy;
          const ol = Math.hypot(ox, oy);
          if (ol < ch * 0.3) { ox = -dy / ch; oy = dx / ch; if (ox * (mx - l.a.sx) + oy * (my - l.a.sy) < 0) { ox = -ox; oy = -oy; } }
          else { ox /= ol; oy /= ol; }
          c = { x: mx + ox * ch * 0.32, y: my + oy * ch * 0.32 * TILT };
        }
        ctx.moveTo(l.a.x, l.a.y);
        ctx.quadraticCurveTo(c.x, c.y, l.b.x, l.b.y);
      };
      const focusLinks = [];
      if (s.prereqMode) {
        const groups = new Map();
        for (const l of s.links) {
          const on = Boolean(focusId) && (l.a.id === focusId || l.b.id === focusId);
          const kind = on ? "on" : l.prereq ? "prereq" : "related";
          const key = `${kind}|${l.provisional ? 1 : 0}`;
          if (!groups.has(key)) groups.set(key, { kind, provisional: l.provisional, list: [] });
          groups.get(key).list.push(l);
        }
        const LINK = { on: ["rgba(235, 240, 255, .85)", 1.6], prereq: ["rgba(200, 210, 240, .3)", 1], related: ["rgba(200, 210, 240, .16)", 1] };
        for (const g of groups.values()) {
          const [color, width] = LINK[g.kind];
          ctx.globalAlpha = focusId && g.kind !== "on" ? dimA * 0.8 : 1;
          ctx.strokeStyle = color;
          ctx.lineWidth = width * px;
          ctx.setLineDash(g.provisional ? [4 * px, 5 * px] : []);
          for (const l of g.list) { ctx.beginPath(); arc(l); ctx.stroke(); }
          if (g.kind !== "related") {
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.beginPath();
            for (const l of g.list) {
              if (!l.prereq) continue;
              const bx = l.b.x - l.b.r - 3;
              ctx.moveTo(bx, l.b.y); ctx.lineTo(bx - 7, l.b.y - 3.5); ctx.lineTo(bx - 7, l.b.y + 3.5); ctx.closePath();
            }
            ctx.fill();
          }
        }
        ctx.setLineDash([]);
      } else {
        if (!s.sky) {
          ctx.strokeStyle = "rgb(200, 210, 240)";
          ctx.lineWidth = px;
          for (const l of s.links) {
            if (focusId && (l.a.id === focusId || l.b.id === focusId)) continue;
            ctx.globalAlpha = (l.provisional ? 0.035 : 0.07) * (focusId ? dimA : 1);
            ctx.beginPath(); arc(l); ctx.stroke();
          }
        }
        if (focusId && fade.mix > 0) for (const l of s.links) if (l.a.id === focusId || l.b.id === focusId) focusLinks.push(l);
        if (focusLinks.length) {
          ctx.globalCompositeOperation = "lighter";
          for (const [wd, al] of [[5, 0.1], [1.3, 0.75]]) {
            ctx.lineWidth = wd * px;
            ctx.strokeStyle = "rgb(225, 232, 255)";
            for (const l of focusLinks) {
              ctx.globalAlpha = fade.mix * al * (l.provisional ? 0.55 : 1);
              ctx.beginPath(); arc(l); ctx.stroke();
            }
          }
          ctx.globalCompositeOperation = "source-over";
        }
      }

      // Planets, far side first, so nearer ones pass in front; each sun sits
      // between the planets behind it and the ones in front. A planet is lit
      // from its sun: the far side of its orbit shows more of its day side.
      const order = s.prereqMode ? s.planets : [...s.planets].sort((a, b) => a.depth - b.depth);
      const pulse = still ? 0.6 : 0.5 + 0.5 * Math.sin((now / 1000) * 2.6);
      const shade = planetShade();
      const toSprite = PLANET_SPRITE / PLANET_R;
      const ringA = s.prereqMode ? 0 : fadeIn(k * (s.sky ? 1 : 1.25), 0.95, 1.45);
      const base = [dpr * k, 0, 0, dpr * k, dpr * cx, dpr * cy];
      // Core concepts carry a faint ring, seen nearly edge-on.
      const drawRing = (p, r, alpha, back) => {
        const rx = r * 1.95, ry = rx * 0.22, from = back ? Math.PI : 0;
        ctx.globalAlpha = alpha * 0.32;
        ctx.strokeStyle = p.ring;
        ctx.lineWidth = r * 0.34;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, rx * 0.9, ry * 0.9, -0.18, from, from + Math.PI); ctx.stroke();
        ctx.globalAlpha = alpha * 0.4;
        ctx.strokeStyle = "rgba(236, 232, 220, .6)";
        ctx.lineWidth = Math.max(r * 0.07, px * 0.6);
        ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, -0.18, from, from + Math.PI); ctx.stroke();
      };
      const drawPlanet = (p) => {
        const r = p.r * (1 + 0.16 * p.depth) * (p.kind === "dust" ? 0.78 : 1);
        const a = (focusId && !isNear(p.id) ? dimA : 1) * (s.prereqMode ? 1 : 0.84 + 0.08 * (p.depth + 1));
        const D = r * toSprite;
        if (p.ring && ringA > 0) drawRing(p, r, a * ringA, true);
        if (p.halo) {
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = a * (p.pulse ? 0.2 + 0.5 * pulse : 0.5);
          ctx.drawImage(glow(p.halo), p.x - r * 3.4, p.y - r * 3.4, r * 6.8, r * 6.8);
          ctx.globalCompositeOperation = "source-over";
        }
        const dust = p.kind === "dust" ? 0.6 : 1;
        ctx.globalAlpha = a * dust;
        ctx.drawImage(planetBody(p.color, p.kind), p.x - D / 2, p.y - D / 2, D, D);
        // Turn the shading to face the sun (or the upper left, in the chart).
        const toward = s.prereqMode ? -2.4 : Math.atan2(p.sy - p.y, p.sx - p.x);
        ctx.globalAlpha = a * dust * (s.prereqMode ? 0.8 : Math.max(0.35, Math.min(1, 0.68 + 0.32 * p.depth)));
        ctx.translate(p.x, p.y);
        ctx.rotate(toward - Math.PI);
        ctx.drawImage(shade, -D / 2, -D / 2, D, D);
        ctx.setTransform(...base);
        if (p.ring && ringA > 0) drawRing(p, r, a * ringA, false);
        if (p.id === selectedRef.current) {
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 5 * Math.max(px, 0.5), 0, Math.PI * 2);
          ctx.lineWidth = 1.3 * px;
          ctx.strokeStyle = "#fff";
          ctx.stroke();
        }
      };
      let sunsDrawn = s.systems.length === 0;
      const drawSuns = () => {
        for (const sys of s.systems) {
          ctx.globalAlpha = holdsFocus(sys) ? 1 : 1 - 0.5 * fade.mix;
          const body = sunSprites(sys.color).body, R = sys.sunR * (256 / 224) * (1 + (breathe - 1) * 0.4);
          ctx.drawImage(body, sys.x - R, sys.y - R, R * 2, R * 2);
        }
        sunsDrawn = true;
      };
      for (const p of order) {
        if (!sunsDrawn && p.depth >= 0) drawSuns();
        drawPlanet(p);
      }
      if (!sunsDrawn) drawSuns();

      // The suns' glare on top: a bright bloom and diffraction spikes, which
      // wash out planets passing close in front.
      ctx.globalCompositeOperation = "lighter";
      for (const sys of s.systems) {
        const sp = sunSprites(sys.color), sa = sysAlpha(sys);
        const B = sys.sunR * 3.1 * breathe;
        ctx.globalAlpha = sa * 0.9;
        ctx.drawImage(sp.bloom, sys.x - B, sys.y - B, B * 2, B * 2);
        const L = sys.sunR * 6.2 * (still ? 1 : 1 + 0.03 * Math.sin(secs * 0.9));
        ctx.globalAlpha = sa * 0.38;
        ctx.translate(sys.x, sys.y);
        ctx.rotate(0.21);
        ctx.drawImage(sp.spikes, -L, -L, L * 2, L * 2);
        ctx.setTransform(...base);
      }
      ctx.globalCompositeOperation = "source-over";

      // Names: book names always; planet names come in as you zoom in (core
      // concepts first), and a planet you point at shows its own name and its
      // links' names. Highest priority first, skipping any that would overlap.
      const placed = [];
      const claim = (x0, y0, x1, y1) => {
        for (const q of placed) if (x0 < q[2] && x1 > q[0] && y0 < q[3] && y1 > q[1]) return false;
        placed.push([x0, y0, x1, y1]);
        return true;
      };
      // Text stays between comfortable on-screen sizes whatever the zoom.
      const fs = Math.max(11.5 / k, Math.min(13, 20 / k)), lh = fs * 1.28;
      const pfs = Math.max(10 / k, Math.min(10.5, 15 / k));
      const suns = s.systems.map(sys => {
        const y0 = sys.y + sys.sunR + 8 + fs;
        const half = Math.max(...sys.lines.map(l => l.length)) * fs * 0.3;
        placed.push([sys.x - half, y0 - fs, sys.x + half, y0 + (sys.lines.length - 1) * lh + fs * 0.4]);
        return { sys, y0 };
      });

      const zoomed = k * (s.sky ? 1 : 1.3) * (s.few ? 1.5 : 1);
      const coreA = s.prereqMode ? 1 : fadeIn(zoomed, 1.05, 1.45);
      const restA = s.prereqMode ? (k > 0.8 ? 1 : 0) : fadeIn(zoomed, 1.65, 2.2);
      const labelA = (p) => {
        const own = p.core ? coreA : restA;
        if (!focusId) return own;
        return isNear(p.id) ? Math.max(own, fade.mix) : own * dimA;
      };
      const rank = (p) => (focusId && isNear(p.id) ? 0 : p.core ? 1 : 2);
      const candidates = order.map(p => [p, labelA(p)]).filter(([, al]) => al > 0.03)
        .sort(([a], [b]) => rank(a) - rank(b) || b.depth - a.depth);
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.font = `500 ${pfs}px ${font}`;
      ctx.lineWidth = pfs * 0.3;
      ctx.strokeStyle = "rgba(4, 5, 10, .6)";
      ctx.fillStyle = "#DADFEA";
      for (const [p, al] of candidates) {
        if (p.labelW == null) { // measured once at the base size, then scaled
          ctx.font = `500 10.5px ${font}`;
          p.labelW = ctx.measureText(p.name).width;
          ctx.font = `500 ${pfs}px ${font}`;
        }
        const y = s.prereqMode ? p.y - p.r - pfs * 0.75 : p.y + p.r * (1 + 0.16 * p.depth) + pfs * 1.2;
        const half = (p.labelW * pfs) / 10.5 / 2 + 2 / k;
        if (!claim(p.x - half, y - pfs, p.x + half, y + pfs * 0.3)) continue;
        ctx.globalAlpha = al * 0.92;
        ctx.strokeText(p.name, p.x, y);
        ctx.fillText(p.name, p.x, y);
      }

      // Book names in the display serif, a little larger, like the titles elsewhere.
      ctx.font = `500 ${fs * 1.12}px ${serif}`;
      ctx.lineWidth = fs * 0.3;
      ctx.strokeStyle = "rgba(4, 5, 10, .5)";
      ctx.fillStyle = "#F1F2F7";
      for (const { sys, y0 } of suns) {
        ctx.globalAlpha = (holdsFocus(sys) ? 1 : 1 - 0.55 * fade.mix) * 0.94;
        sys.lines.forEach((line, i) => {
          ctx.strokeText(line, sys.x, y0 + i * lh);
          ctx.fillText(line, sys.x, y0 + i * lh);
        });
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = sceneRef.current;
      // Orbit speed eases to a stop while you point at or open a planet.
      const c = clock.current;
      orbitTime();
      const target = still || c.hold || s?.prereqMode ? 0 : 1;
      c.speed += (target - c.speed) * Math.min(1, dt * 3.2);
      if (Math.abs(target - c.speed) < 0.003) c.speed = target;
      c.t += dt * c.speed;
      // Highlights fade in and out.
      const f = focusFade.current, want = hover.current ?? selectedRef.current;
      if (want && want !== f.id) { f.id = want; f.mix = Math.max(f.mix, 0.35); }
      const goal = want ? 1 : 0, before = f.mix;
      f.mix += (goal - f.mix) * Math.min(1, dt * 9);
      if (Math.abs(goal - f.mix) < 0.01) f.mix = goal;
      if (!want && f.mix === 0) f.id = null;
      // Camera glides.
      const a = camAnim.current;
      if (a) {
        const p = Math.min(1, (now - a.t0) / a.ms), e = ease(p);
        const to = typeof a.to === "function" ? a.to() : a.to;
        setCam({ x: a.from.x + (to.x - a.from.x) * e, y: a.from.y + (to.y - a.from.y) * e, k: a.from.k + (to.k - a.from.k) * e });
        if (p >= 1) camAnim.current = null;
      }
      // The sky moves, and the stars breathe (slowly, so that needs far fewer frames).
      const breathing = !still && s && !s.prereqMode && now - drawnAt > 70;
      if (dirty.current || c.speed > 0 || f.mix !== before || breathing) { draw(now); drawnAt = now; dirty.current = false; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // Where a concept is on screen right now (used by the interface tests).
    canvas.mapProbe = (id) => {
      const p = sceneRef.current?.byId.get(id);
      if (!p) return null;
      const { x, y, k } = cam.current;
      return { x: p.x * k + x, y: p.y * k + y };
    };
    return () => cancelAnimationFrame(raf);
  }, [setCam, hasPlanets]);

  // ── Pointer ────────────────────────────────────────────────────────────
  const toMap = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const { x, y, k } = cam.current;
    return { wx: (e.clientX - r.left - x) / k, wy: (e.clientY - r.top - y) / k };
  };
  const planetAtPoint = (wx, wy) => {
    const s = sceneRef.current, k = cam.current.k;
    let best = null, bestD = Infinity;
    for (const p of s?.planets || []) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < p.r * (1 + 0.16 * p.depth) + 7 / k && d < bestD) { best = p; bestD = d; }
    }
    return best;
  };
  const sunAtPoint = (wx, wy) => (sceneRef.current?.systems || []).find(sys => {
    if (Math.hypot(sys.x - wx, sys.y - wy) < sys.sunR * 1.4) return true;
    const half = Math.max(...sys.lines.map(l => l.length)) * 4;
    return Math.abs(wx - sys.x) < half && wy > sys.y + sys.sunR && wy < sys.y + sys.sunR + 12 + sys.lines.length * 18;
  });

  const onPointerDown = (e) => {
    camAnim.current = null;
    drag.current = { x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y, k: cam.current.k, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (d) {
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return; // a click, not a drag
      d.moved = true;
      e.currentTarget.style.cursor = "grabbing";
      setCam({ k: d.k, x: d.cx + e.clientX - d.x, y: d.cy + e.clientY - d.y });
      return;
    }
    const { wx, wy } = toMap(e);
    const id = planetAtPoint(wx, wy)?.id ?? null;
    e.currentTarget.style.cursor = id ? "pointer" : sunAtPoint(wx, wy) ? "zoom-in" : "grab";
    if (id === pointerOn.current) return;
    // Pointing at a planet slows the sky to a stop right away, so it's easy to click;
    // the highlight follows after a short pause, so sweeping across the map doesn't flash.
    pointerOn.current = id;
    clock.current.hold = Boolean(id) || Boolean(selectedRef.current);
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => { hover.current = id; dirty.current = true; }, id ? 90 : 140);
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    e.currentTarget.style.cursor = "grab";
    if (d?.moved) return;
    const { wx, wy } = toMap(e);
    const p = planetAtPoint(wx, wy);
    if (p) { choose(p.id); return; }
    const sys = sunAtPoint(wx, wy);
    if (sys) { focusSystem(sys); return; }
    setSelected(null);
  };
  const onPointerLeave = () => {
    pointerOn.current = null;
    clock.current.hold = Boolean(selectedRef.current);
    clearTimeout(hoverTimer.current);
    hover.current = null;
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let pending = 0, frame = 0, at = null;
    const onWheel = (e) => {
      e.preventDefault();
      camAnim.current = null;
      const r = canvas.getBoundingClientRect();
      at = { x: e.clientX - r.left, y: e.clientY - r.top };
      pending += e.deltaY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const v = cam.current;
        const k = Math.min(4, Math.max(0.12, v.k * Math.exp(-pending * 0.0012)));
        setCam({ k, x: at.x - ((at.x - v.x) / v.k) * k, y: at.y - ((at.y - v.y) / v.k) * k });
        pending = 0; frame = 0;
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => { canvas.removeEventListener("wheel", onWheel); cancelAnimationFrame(frame); };
  }, [setCam, hasPlanets]);

  const zoom = (f) => {
    const { w, h } = size.current, v = cam.current;
    const k = Math.min(4, Math.max(0.12, v.k * f));
    glideTo({ k, x: w / 2 - ((w / 2 - v.x) / v.k) * k, y: h / 2 - ((h / 2 - v.y) / v.k) * k }, 260);
  };

  const coursesWithConcepts = state.courses.filter(c => state.concepts.some(k => k.courseId === c.id && !k.suspended));
  const pickScope = (v) => { setScope(v); setSelected(null); if (v === "all") setModeState("orbits"); };

  return (
    <div className="page map-page">
      <div className="page-head">
        <div><h1>Knowledge map</h1></div>
        <div className="row">
          {scope !== "all" && (
            <div className="seg" role="group" aria-label="Map view">
              <button className={mode === "orbits" ? "on" : ""} onClick={() => setMode("orbits")}>Orbits</button>
              <button className={mode === "prereq" ? "on" : ""} onClick={() => { setMode("prereq"); setSelected(null); }}>Prerequisites</button>
            </div>
          )}
          <select className="select" style={{ width: 260 }} value={scope} onChange={e => pickScope(e.target.value)} aria-label="Map scope">
            <option value="all">All books and courses</option>
            {coursesWithConcepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {!hasPlanets ? (
        <div className="panel empty">
          <h3>Nothing to map yet</h3>
          <button className="btn btn-primary" onClick={() => nav.go("courses")}>Go to courses</button>
        </div>
      ) : (
        <div className="map-wrap space" ref={wrapRef}>
          <canvas className="space-galaxy" ref={galaxyRef} aria-hidden="true"/>
          <div className="space-bg" ref={spaceRef} style={{ backgroundImage: [starTiles().far, starTiles().near, ...NEBULA].join(", ") }}/>
          <div className="space-twinkle" ref={twinkleRef} style={{ backgroundImage: starTiles().twinkle }}/>
          <div className="shooting-star"/>
          <canvas ref={canvasRef} className="map-canvas" role="img" aria-label="Knowledge map"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave}/>
          <div className="map-zoom">
            <button className="btn btn-icon btn-sm" onClick={() => zoom(1.25)} aria-label="Zoom in"><Icon name="zoomIn" size={16}/></button>
            <button className="btn btn-icon btn-sm" onClick={() => zoom(0.8)} aria-label="Zoom out"><Icon name="zoomOut" size={16}/></button>
            <button className="btn btn-icon btn-sm" onClick={fit} aria-label="Fit to screen"><Icon name="fit" size={16}/></button>
          </div>
          <div className="map-legend">
            <span><span className="dot planet bright" style={{ "--c": "#9FB0FF" }}/>Mastered</span>
            <span><span className="dot planet" style={{ "--c": "#8F9AD0" }}/>Learning</span>
            <span><span className="dot planet bright" style={{ "--c": SLIPPING }}/>Slipping</span>
            <span><span className="dot planet dark" style={{ "--c": "#9FB0FF" }}/>Not started</span>
            {ix.lockedConcepts.size > 0 && <span><span className="dot planet dust"/>Unread chapter</span>}
            {scope === "all" && scene.bridges.length > 0 && <span><span className="legend-stream"/>Links between books</span>}
          </div>
        </div>
      )}

      {selected && ix.concept[selected] && (
        <ConceptPanel modeless enter={false} conceptId={selected}
          onOpen={(id) => (scene.byId.has(id) ? choose(id) : setSelected(id))}
          onClose={() => setSelected(null)}/>
      )}
    </div>
  );
}
