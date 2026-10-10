// The knowledge map as a sky full of solar systems.
//
//   • each book or course is a star, with its name at the centre
//   • each chapter is an orbit around it, the first chapter innermost
//   • each concept is a planet on its chapter's orbit, sized by importance
//   • links between concepts (what builds on what, what's related) are drawn
//     between the planets, across systems too
//
// Orbits are tilted ellipses, so a system reads like a plane seen at an angle,
// and inner orbits turn faster than outer ones (roughly Kepler's third law).
// Everything here is pure: positions are a function of layout + time.

export const TILT = 0.62;              // vertical squash of every orbit
const PLANET_SPACING = 30;             // arc length between neighbours on an orbit
const RING_GAP = 30;                   // distance between successive orbits
const MIN_FIRST_RING = 84;
const INNER_PERIOD = 75;               // seconds for one lap of a system's first orbit
const SYSTEM_GAP = 120;                // empty space between neighbouring systems
const LINE_CHARS = 18;                 // the star's name wraps at about this many characters

/** Deterministic pseudo-random in [0, 1) from a string. */
export function seeded(id, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/** A course name wrapped into at most three short lines for the centre of its system. */
export function wrapName(name, max = LINE_CHARS) {
  const words = String(name || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > 3) {
    const kept = lines.slice(0, 3);
    kept[2] = kept[2].length > max - 1 ? `${kept[2].slice(0, max - 1)}…` : `${kept[2]}…`;
    return kept;
  }
  return lines.map(l => (l.length > max + 6 ? `${l.slice(0, max + 5)}…` : l));
}

/**
 * Lay out systems for these courses.
 * courses: [{ id, name, color }], sections: [{ id, courseId, order, locked, title }],
 * concepts: [{ id, courseId, sectionId, order, importance }]
 * Returns { systems: [{ id, name, color, lines, x, y, radius, rings: [{ sectionId, title, r, locked }] }],
 *           planets: { [conceptId]: { id, system, sx, sy, r, phase, omega, ring } } }
 */
export function orbitalLayout({ courses, sections, concepts }) {
  const bySection = new Map();
  for (const c of concepts) {
    if (!bySection.has(c.sectionId)) bySection.set(c.sectionId, []);
    bySection.get(c.sectionId).push(c);
  }
  const sectionsByCourse = new Map();
  for (const s of sections) {
    if (!bySection.has(s.id)) continue;
    if (!sectionsByCourse.has(s.courseId)) sectionsByCourse.set(s.courseId, []);
    sectionsByCourse.get(s.courseId).push(s);
  }

  const systems = [];
  const planets = {};
  for (const course of courses) {
    const secs = (sectionsByCourse.get(course.id) || [])
      .slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));
    if (!secs.length) continue;
    const lines = wrapName(course.name);
    const labelHalf = Math.max(...lines.map(l => l.length)) * 3.9;
    const first = Math.max(MIN_FIRST_RING, labelHalf + 30);
    const rings = [];
    let r = 0;
    for (const s of secs) {
      const list = bySection.get(s.id).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const needed = (list.length * PLANET_SPACING) / (2 * Math.PI);
      r = rings.length ? Math.max(r + RING_GAP, needed) : Math.max(first, needed);
      const period = INNER_PERIOD * Math.pow(r / first, 1.5);
      const omega = (2 * Math.PI) / period;
      const start = seeded(s.id) * 2 * Math.PI;
      list.forEach((c, i) => {
        planets[c.id] = { id: c.id, system: course.id, sx: 0, sy: 0, r, omega, ring: rings.length,
          phase: start + (i * 2 * Math.PI) / list.length };
      });
      rings.push({ sectionId: s.id, title: s.title, r, locked: Boolean(s.locked) });
    }
    systems.push({ id: course.id, name: course.name, color: course.color, lines, x: 0, y: 0, radius: r + 46, rings });
  }

  // Systems sit around a circle, each given room for its widest orbit.
  if (systems.length > 1) {
    const circumference = systems.reduce((n, s) => n + 2 * s.radius + SYSTEM_GAP, 0);
    const R = Math.max(circumference / (2 * Math.PI), Math.max(...systems.map(s => s.radius)) + SYSTEM_GAP / 2);
    let at = -Math.PI / 2;
    for (const s of systems) {
      const share = ((2 * s.radius + SYSTEM_GAP) / circumference) * 2 * Math.PI;
      const a = at + share / 2;
      s.x = Math.cos(a) * R;
      s.y = Math.sin(a) * R * 0.78; // a little flatter than a circle: screens are wide
      at += share;
    }
  }
  const sys = Object.fromEntries(systems.map(s => [s.id, s]));
  for (const p of Object.values(planets)) { p.sx = sys[p.system].x; p.sy = sys[p.system].y; }
  return { systems, planets };
}

/** Where a planet is at time t (seconds). depth runs from -1 (far side) to 1 (near side). */
export function planetAt(p, t) {
  const a = p.phase + p.omega * t;
  const s = Math.sin(a);
  return { x: p.sx + p.r * Math.cos(a), y: p.sy + p.r * s * TILT, depth: s };
}

/** The box around every system (for fitting the view). */
export function systemBounds(systems) {
  if (!systems.length) return { x0: -100, y0: -100, x1: 100, y1: 100 };
  return {
    x0: Math.min(...systems.map(s => s.x - s.radius)),
    x1: Math.max(...systems.map(s => s.x + s.radius)),
    y0: Math.min(...systems.map(s => s.y - s.radius * TILT - 30)),
    y1: Math.max(...systems.map(s => s.y + s.radius * TILT + 30)),
  };
}

/**
 * Links between books, gathered into one stream per pair of books (the map
 * draws a soft band between their suns instead of every line).
 * pairs: [{ a, b }] system ids of each link's ends. Returns [{ a, b, n }].
 */
export function bridgesBetween(pairs) {
  const byPair = new Map();
  for (const { a, b } of pairs) {
    if (a === b) continue;
    const [x, y] = String(a) < String(b) ? [a, b] : [b, a];
    const key = `${x}|${y}`;
    byPair.set(key, { a: x, b: y, n: (byPair.get(key)?.n || 0) + 1 });
  }
  return [...byPair.values()];
}

/** The control point that bows a curve from a to b to its left by `bend` times its length. */
export function bow(ax, ay, bx, by, bend) {
  return { x: (ax + bx) / 2 + (by - ay) * bend, y: (ay + by) / 2 - (bx - ax) * bend };
}

/** A point on the quadratic curve from a through control c to b, at t in [0, 1]. */
export function onCurve(ax, ay, c, bx, by, t) {
  const u = 1 - t;
  return { x: u * u * ax + 2 * u * t * c.x + t * t * bx, y: u * u * ay + 2 * u * t * c.y + t * t * by };
}

/** 0 at or below `from`, 1 at or above `to`, easing in between (things that appear as you zoom in). */
export function fadeIn(v, from, to) {
  const t = Math.max(0, Math.min(1, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
