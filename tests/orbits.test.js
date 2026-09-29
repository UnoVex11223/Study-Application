import { test } from "node:test";
import assert from "node:assert/strict";

import { orbitalLayout, planetAt, wrapName, systemBounds, TILT } from "../src/lib/orbits.js";

function sky(nCourses = 5) {
  const courses = [], sections = [], concepts = [];
  for (let c = 0; c < nCourses; c++) {
    courses.push({ id: `c${c}`, name: c === 0 ? "Computer Networking: A Top-Down Approach" : `Course ${c}`, color: "#6F7FD4" });
    for (let s = 0; s < 3 + c * 2; s++) {
      sections.push({ id: `c${c}s${s}`, courseId: `c${c}`, order: s, locked: s === 2, title: `Chapter ${s + 1}` });
      for (let k = 0; k < 3 + ((s * 5) % 17); k++) concepts.push({ id: `c${c}s${s}k${k}`, courseId: `c${c}`, sectionId: `c${c}s${s}`, order: k });
    }
  }
  courses.push({ id: "empty", name: "No concepts yet", color: "#fff" });
  return { courses, sections, concepts };
}

test("each book is a star; its chapters are orbits, first chapter innermost; every concept is a planet", () => {
  const input = sky();
  const { systems, planets } = orbitalLayout(input);
  assert.equal(systems.length, 5, "a course with no concepts isn't drawn");
  assert.equal(Object.keys(planets).length, input.concepts.length);
  for (const s of systems) {
    const rs = s.rings.map(r => r.r);
    assert.deepEqual(rs, [...rs].sort((a, b) => a - b));
    assert.ok(rs.every((r, i) => i === 0 || r - rs[i - 1] >= 30), "orbits don't touch");
    assert.equal(s.rings[0].sectionId, `${s.id}s0`);
    assert.equal(s.rings[2].locked, true);
  }
  const net = systems[0];
  assert.ok(net.rings[0].r > 84, "a long name at the centre pushes the first orbit out");
  assert.ok(net.lines.length >= 2 && net.lines.every(l => l.length <= 24));
});

test("inner planets move faster, and planets on an orbit keep their distance", () => {
  const { planets } = orbitalLayout(sky(2));
  const inner = planets.c1s0k0, outer = planets.c1s4k0;
  assert.ok(inner.omega > outer.omega);
  const ring = Object.values(planets).filter(p => p.system === "c1" && p.ring === 3);
  const arc = (2 * Math.PI / ring.length) * ring[0].r;
  assert.ok(arc >= 29.9, "at least 30 units apart along the orbit");
  const a = planetAt(inner, 0), b = planetAt(inner, 10);
  assert.notDeepEqual(a, b, "it moves");
  const back = planetAt(inner, (2 * Math.PI) / inner.omega);
  assert.ok(Math.abs(back.x - a.x) < 1e-6 && Math.abs(back.y - a.y) < 1e-6, "and comes round again");
  assert.ok(Math.abs(a.y - inner.sy) <= inner.r * TILT + 1e-9, "orbits are tilted");
});

test("systems don't overlap each other", () => {
  const { systems } = orbitalLayout(sky(7));
  for (let i = 0; i < systems.length; i++) {
    for (let j = i + 1; j < systems.length; j++) {
      const a = systems[i], b = systems[j];
      const d = Math.hypot(a.x - b.x, (a.y - b.y) / 0.78);
      assert.ok(d >= a.radius + b.radius, `${a.id} and ${b.id} are ${d.toFixed(0)} apart, need ${a.radius + b.radius}`);
    }
  }
  const box = systemBounds(systems);
  assert.ok(box.x1 > box.x0 && box.y1 > box.y0);
});

test("a single course sits in the middle", () => {
  const input = sky(1);
  const { systems } = orbitalLayout(input);
  assert.deepEqual([systems[0].x, systems[0].y], [0, 0]);
});

test("names wrap onto at most three lines", () => {
  assert.deepEqual(wrapName("SQLite"), ["SQLite"]);
  assert.deepEqual(wrapName("The C Programming Language"), ["The C Programming", "Language"]);
  const long = wrapName("Structure and Interpretation of Computer Programs, Second Edition, with extra words at the end");
  assert.equal(long.length, 3);
  assert.ok(long[2].endsWith("…"));
});
