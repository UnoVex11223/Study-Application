import { test } from "node:test";
import assert from "node:assert/strict";

import { lapseTimeline, statusOn, lapseDay } from "../src/lib/timelapse.js";
import { prereqPath } from "../src/lib/graph.js";
import { conceptMastery } from "../src/lib/mastery.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem } from "../src/lib/model.js";

const DAY = 864e5;
const T0 = new Date(2026, 8, 1, 12).getTime();
const key = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function world() {
  const s = emptyState();
  const c = makeCourse({ name: "C" });
  const sec = makeSection({ courseId: c.id });
  const ks = ["a", "b", "c"].map((n, i) => makeConcept({ id: n, courseId: c.id, sectionId: sec.id, name: n, createdAt: T0 + i * DAY }));
  const att = (conceptId, d, ok) => ({ id: `${conceptId}${d}`, conceptId, itemId: `i${conceptId}`, verdict: ok ? "correct" : "incorrect", aided: false,
    mode: "review", ability: "recall", day: key(T0 + d * DAY), ts: T0 + d * DAY });
  return {
    ...s, courses: [c], sections: [sec], concepts: ks,
    items: ks.map(k => makeItem({ id: `i${k.id}`, conceptId: k.id, ability: "recall" })),
    attempts: [att("a", 2, true), att("a", 5, true), att("b", 3, true), att("b", 6, false)],
  };
}

test("each concept appears when it was added and changes on the days its answers changed it", () => {
  const s = world();
  const t = lapseTimeline(s, T0 + 10 * DAY, 0);
  assert.equal(t.start, key(T0));
  assert.equal(t.days, 11);
  assert.equal(t.appear.c, key(T0 + 2 * DAY));
  assert.deepEqual(t.changes.a.map(c => c.status), ["practiced", "mastered"]);
  assert.equal(statusOn(t.changes.a, key(T0 + 1 * DAY)), "new");
  assert.equal(statusOn(t.changes.a, key(T0 + 3 * DAY)), "practiced");
  assert.equal(statusOn(t.changes.a, key(T0 + 9 * DAY)), "mastered");
  assert.equal(statusOn(t.changes.b, key(T0 + 7 * DAY)), "slipping");
  assert.equal(lapseDay(t, 999), t.end);
  assert.equal(lapseDay(t, -3), t.start);
});

test("the last day of the time-lapse matches the map as it is now", () => {
  const s = world();
  const now = T0 + 10 * DAY;
  const t = lapseTimeline(s, now, 0);
  for (const c of s.concepts) assert.equal(statusOn(t.changes[c.id], t.end), conceptMastery(s, c.id, now).status, c.id);
});

test("a concept's learning path: everything it builds on, first steps first", () => {
  const edges = [
    { type: "prereq", from: "vars", to: "ptr" }, { type: "prereq", from: "addr", to: "ptr" },
    { type: "prereq", from: "vars", to: "addr" }, { type: "prereq", from: "ptr", to: "arr" },
    { type: "prereq", from: "maybe", to: "ptr", confidence: 0.4 }, { type: "related", from: "x", to: "ptr" },
    { type: "prereq", from: "ptr", to: "later" },
  ];
  const p = prereqPath(edges, "arr");
  assert.deepEqual(p.nodes, ["vars", "addr", "ptr", "arr"]);
  assert.deepEqual(p.depth, { arr: 3, ptr: 2, addr: 1, vars: 0 });
  assert.equal(p.links.length, 4);
  assert.ok(!p.nodes.includes("maybe") && !p.nodes.includes("later") && !p.nodes.includes("x"));
  assert.deepEqual(prereqPath(edges, "vars").nodes, ["vars"], "nothing before the first step");
  const loop = prereqPath([{ type: "prereq", from: "a", to: "b" }, { type: "prereq", from: "b", to: "a" }], "a");
  assert.equal(loop.nodes.length, 2, "a cycle doesn't hang it");
});
