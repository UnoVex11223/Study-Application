// The knowledge map: every book is a star with its name at the centre, its
// chapters are orbits and its concepts are planets going round (see
// lib/orbits.js). Links between concepts are drawn between the planets, across
// systems too. A single course can also be shown as its prerequisite chart.
//
// Drawn on a canvas: hundreds of moving planets and links redraw in a couple
// of milliseconds, where SVG would repaint the whole map on every frame.
// React only re-renders when the view or the selected concept changes.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { useNav } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import ConceptPanel from "./ConceptPanel.jsx";
import { index } from "../lib/model.js";
import { conceptMastery } from "../lib/mastery.js";
import { layeredLayout } from "../lib/graph.js";
import { orbitalLayout, planetAt, systemBounds, seeded, TILT } from "../lib/orbits.js";

const RADIUS = { core: 6, supporting: 4.6, detail: 3.6 };
const SLIPPING = "#F2A65A";
const LOCKED = "rgba(150, 156, 175, .34)";
const MAX_LABEL = 30;
const short = (n) => (n.length > MAX_LABEL ? `${n.slice(0, MAX_LABEL - 1)}…` : n);
const stillPreferred = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** A tile of stars for the background, as an SVG data URL (same stars every time). */
function starTile(size, count, salt, bright) {
  let dots = "";
  for (let i = 0; i < count; i++) {
    const x = (seeded(`x${i}`, salt) * size).toFixed(1), y = (seeded(`y${i}`, salt) * size).toFixed(1);
    const r = (0.35 + seeded(`r${i}`, salt) * 0.95).toFixed(2);
    const o = (0.25 + seeded(`o${i}`, salt) * 0.75 * bright).toFixed(2);
    const tint = seeded(`t${i}`, salt);
    const fill = tint < 0.12 ? "#bcd0ff" : tint > 0.93 ? "#ffe2b8" : "#ffffff";
    dots += `<circle cx='${x}' cy='${y}' r='${r}' fill='${fill}' fill-opacity='${o}'/>`;
  }
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${dots}</svg>`)}")`;
}
const STARS_FAR = starTile(300, 70, 11, 0.6);
const STARS_NEAR = starTile(520, 34, 23, 1);
const STARS_TWINKLE = starTile(410, 18, 37, 1);
const NEBULA = [
  "radial-gradient(ellipse 60% 45% at 18% 28%, rgba(111, 127, 212, .16), transparent 70%)",
  "radial-gradient(ellipse 50% 40% at 82% 72%, rgba(162, 134, 204, .13), transparent 70%)",
  "radial-gradient(ellipse 45% 35% at 62% 12%, rgba(94, 162, 191, .09), transparent 70%)",
];

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

/** How a planet looks for its mastery status. */
function planetLook(status, color, locked) {
  if (locked) return { fill: LOCKED };
  if (status === "mastered") return { fill: color, halo: color };
  if (status === "learning" || status === "practiced") return { fill: withAlpha(color, 0.75) };
  if (status === "slipping") return { fill: SLIPPING, halo: SLIPPING, pulse: true };
  return { fill: "#0B0E18", stroke: color };
}

export default function KnowledgeMap({ focusCourseId, focusConceptId }) {
  const { state } = useStore();
  const nav = useNav();
  const ix = index(state);
  const [scope, setScope] = useState(focusCourseId ?? "all");
  const [mode, setMode] = useState("orbits");
  const [selected, setSelected] = useState(focusConceptId ?? null);

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const spaceRef = useRef(null);
  const twinkleRef = useRef(null);
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
      const color = ix.course[c.courseId]?.color || "#8A93A6";
      planets.push({
        id: c.id, courseId: c.courseId, name: short(c.name), core: c.importance === "core",
        r: RADIUS[c.importance] ?? 5, orbit: o || null, fixed: f || null, x: f?.x ?? 0, y: f?.y ?? 0, depth: 0,
        look: planetLook(conceptMastery(state, c.id).status, color, ix.lockedConcepts.has(c.id)),
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
    return { planets, byId, links, adj, systems: orbit?.systems || [], prereqMode, sky: scope === "all", showAllLabels: planets.length <= 60 };
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
    if (spaceRef.current) spaceRef.current.style.backgroundPosition = `${v.x * 0.03}px ${v.y * 0.03}px, ${v.x * 0.08}px ${v.y * 0.08}px, 0 0, 0 0, 0 0`;
    if (twinkleRef.current) twinkleRef.current.style.backgroundPosition = `${v.x * 0.055}px ${v.y * 0.055}px`;
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
  const choose = useCallback((id) => {
    setSelected(id);
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

      // Stars: a slowly breathing glow, and the chapter orbits around it.
      const breathe = still ? 1 : 0.86 + 0.14 * Math.sin((now / 1000) * (2 * Math.PI / 8));
      for (const sys of s.systems) {
        const a = holdsFocus(sys) ? 1 : 1 - 0.6 * fade.mix;
        const R = sys.rings[0].r * 1.1;
        ctx.globalAlpha = a * breathe;
        ctx.drawImage(glow(sys.color), sys.x - R, sys.y - R, R * 2, R * 2);
        ctx.globalAlpha = a;
        ctx.lineWidth = px;
        ctx.strokeStyle = "rgba(210, 218, 240, .09)";
        for (const ring of sys.rings) {
          ctx.setLineDash(ring.locked ? [3 * px, 6 * px] : []);
          ctx.beginPath();
          ctx.ellipse(sys.x, sys.y, ring.r, ring.r * TILT, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // Links: between systems always; inside a system when you're looking at one course, or around the focus.
      // Grouped by look, so each group is stroked in one go.
      const groups = new Map();
      for (const l of s.links) {
        const on = Boolean(focusId) && (l.a.id === focusId || l.b.id === focusId);
        if (s.sky && !l.cross && !on) continue;
        const kind = on ? "on" : l.cross ? "cross" : l.prereq ? "prereq" : "related";
        const key = `${kind}|${l.provisional ? 1 : 0}`;
        if (!groups.has(key)) groups.set(key, { kind, provisional: l.provisional, list: [] });
        groups.get(key).list.push(l);
      }
      const LINK = {
        on: ["rgba(235, 240, 255, .85)", 1.6], cross: ["rgba(190, 205, 255, .26)", 1.2],
        prereq: ["rgba(200, 210, 240, .3)", 1], related: ["rgba(200, 210, 240, .16)", 1],
      };
      const crossCount = s.links.reduce((n, l) => n + (l.cross ? 1 : 0), 0);
      const crowd = Math.min(1, Math.sqrt(40 / Math.max(1, crossCount))); // lots of links between books: draw them fainter
      for (const g of groups.values()) {
        const [color, width] = LINK[g.kind];
        ctx.globalAlpha = (focusId && g.kind !== "on" ? dimA * 0.8 : 1) * (g.kind === "cross" ? crowd : 1);
        ctx.strokeStyle = color;
        ctx.lineWidth = width * px;
        ctx.setLineDash(g.provisional ? [4 * px, 5 * px] : []);
        // One stroke per link: long overlapping lines are slower to fill as a single path.
        for (const l of g.list) {
          ctx.beginPath();
          if (s.prereqMode) {
            const ax = l.a.x + l.a.r + 2, bx = l.b.x - l.b.r - 3, mx = (l.a.x + l.b.x) / 2;
            ctx.moveTo(ax, l.a.y);
            ctx.bezierCurveTo(mx, l.a.y, mx, l.b.y, bx, l.b.y);
          } else {
            ctx.moveTo(l.a.x, l.a.y);
            ctx.lineTo(l.b.x, l.b.y);
          }
          ctx.stroke();
        }
        if (s.prereqMode && g.kind !== "related") {
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

      // Planets, far side first, so nearer ones pass in front.
      const order = s.prereqMode ? s.planets : [...s.planets].sort((a, b) => a.depth - b.depth);
      const pulse = still ? 0.6 : 0.5 + 0.5 * Math.sin((now / 1000) * 2.6);
      for (const p of order) {
        const r = p.r * (1 + 0.16 * p.depth);
        const a = focusId && !isNear(p.id) ? dimA : 1;
        if (p.look.halo) {
          ctx.globalAlpha = a * (p.look.pulse ? 0.25 + 0.55 * pulse : 0.7);
          ctx.drawImage(glow(p.look.halo), p.x - r * 3, p.y - r * 3, r * 6, r * 6);
        }
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = p.look.fill;
        ctx.fill();
        if (p.look.stroke) { ctx.lineWidth = 1.5; ctx.strokeStyle = p.look.stroke; ctx.stroke(); }
        if (p.id === selectedRef.current) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 4.5, 0, Math.PI * 2);
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = "#fff";
          ctx.stroke();
        }
      }

      // Names: book names first (they're kept readable when zoomed out), then
      // planet names by priority (the focus and its links, then core concepts,
      // then the nearest), skipping any that would overlap one already placed.
      const placed = [];
      const claim = (x0, y0, x1, y1) => {
        for (const q of placed) if (x0 < q[2] && x1 > q[0] && y0 < q[3] && y1 > q[1]) return false;
        placed.push([x0, y0, x1, y1]);
        return true;
      };
      const fs = Math.max(13, 11.5 / k), lh = fs * 1.25;
      const suns = s.systems.map(sys => {
        const y0 = sys.y - ((sys.lines.length - 1) * lh) / 2 + fs * 0.35;
        const half = Math.max(...sys.lines.map(l => l.length)) * fs * 0.3;
        placed.push([sys.x - half, y0 - fs, sys.x + half, y0 + (sys.lines.length - 1) * lh + fs * 0.4]);
        return { sys, y0 };
      });

      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.font = `600 10.5px ${font}`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "#05060B";
      ctx.fillStyle = "#D9DDE8";
      const rank = (p) => (focusId && isNear(p.id) ? 0 : p.core ? 1 : 2);
      const candidates = order.filter(p => s.showAllLabels || k > 1.2 || (p.core && k > 0.8) || (focusId && isNear(p.id)))
        .sort((a, b) => rank(a) - rank(b) || b.depth - a.depth);
      for (const p of candidates) {
        if (p.labelW == null) p.labelW = ctx.measureText(p.name).width;
        const y = s.prereqMode ? p.y - p.r - 8 : p.y + p.r * (1 + 0.16 * p.depth) + 12;
        const half = p.labelW / 2 + 2;
        if (!claim(p.x - half, y - 10, p.x + half, y + 3)) continue;
        ctx.globalAlpha = focusId && !isNear(p.id) ? dimA : 1;
        ctx.strokeText(p.name, p.x, y);
        ctx.fillText(p.name, p.x, y);
      }

      ctx.font = `650 ${fs}px ${font}`;
      ctx.lineWidth = fs * 0.32;
      ctx.strokeStyle = "rgba(5, 6, 11, .6)";
      ctx.fillStyle = "#F4F5FA";
      for (const { sys, y0 } of suns) {
        ctx.globalAlpha = holdsFocus(sys) ? 1 : 1 - 0.55 * fade.mix;
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
  const sunAtPoint = (wx, wy) => (sceneRef.current?.systems || [])
    .find(sys => Math.hypot((sys.x - wx) / 1.6, sys.y - wy) < sys.rings[0].r * 0.5);

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
  const pickScope = (v) => { setScope(v); setSelected(null); if (v === "all") setMode("orbits"); };

  return (
    <div className="page" style={{ maxWidth: "none" }}>
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
          <div className="space-bg" ref={spaceRef} style={{ backgroundImage: [STARS_FAR, STARS_NEAR, ...NEBULA].join(", ") }}/>
          <div className="space-twinkle" ref={twinkleRef} style={{ backgroundImage: STARS_TWINKLE }}/>
          <div className="shooting-star"/>
          <canvas ref={canvasRef} className="map-canvas" role="img" aria-label="Knowledge map"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave}/>
          <div className="map-zoom">
            <button className="btn btn-icon btn-sm" onClick={() => zoom(1.25)} aria-label="Zoom in"><Icon name="zoomIn" size={16}/></button>
            <button className="btn btn-icon btn-sm" onClick={() => zoom(0.8)} aria-label="Zoom out"><Icon name="zoomOut" size={16}/></button>
            <button className="btn btn-icon btn-sm" onClick={fit} aria-label="Fit to screen"><Icon name="fit" size={16}/></button>
          </div>
          <div className="map-legend">
            <span><span className="dot glow" style={{ background: "#9fb0ff", color: "#9fb0ff" }}/>Mastered</span>
            <span><span className="dot" style={{ background: "#9fb0ff", opacity: 0.75 }}/>Learning</span>
            <span><span className="dot glow" style={{ background: SLIPPING, color: SLIPPING }}/>Slipping</span>
            <span><span className="dot" style={{ border: "1.5px solid #9fb0ff" }}/>Not started</span>
            {ix.lockedConcepts.size > 0 && <span><span className="dot" style={{ background: LOCKED }}/>Unread chapter</span>}
            <span><svg width="22" height="6"><path d="M0 3h22" stroke="rgba(214, 222, 255, .6)" strokeWidth="1.4"/></svg>Link</span>
          </div>
        </div>
      )}

      {selected && ix.concept[selected] && (
        <ConceptPanel modeless conceptId={selected}
          onOpen={(id) => (scene.byId.has(id) ? choose(id) : setSelected(id))}
          onClose={() => setSelected(null)}/>
      )}
    </div>
  );
}
