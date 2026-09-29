import { test } from "node:test";
import assert from "node:assert/strict";

import { newSrs, RATING } from "../src/lib/fsrs.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem, normalizeState, index } from "../src/lib/model.js";
import { buildPlan, forecastLoad, pickItem } from "../src/lib/planner.js";
import { reducer } from "../src/state/reducer.js";
import { LEECH_LAPSES } from "../src/lib/quality.js";

const DAY = 864e5;
const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime();

function world(conceptsN, abilities) {
  const s = emptyState();
  s.settings.dailyMinutes = 120;
  const course = makeCourse({ name: "C" });
  const sec = makeSection({ courseId: course.id, title: "S" });
  s.courses.push(course); s.sections.push(sec);
  for (let k = 0; k < conceptsN; k++) {
    const c = makeConcept({ courseId: course.id, sectionId: sec.id, name: `K${k}`, order: k });
    s.concepts.push(c);
    for (const ability of abilities) s.items.push(makeItem({ conceptId: c.id, ability, prompt: `${ability} ${k}`, answer: "a", points: ["a"] }));
  }
  return s;
}

const reviewSrs = (due) => ({ ...newSrs(), state: "review", stability: 5, difficulty: 5, lastReview: due - 5 * DAY, due, reps: 3 });

test("review time scales with concepts, not with how many questions each has", () => {
  const s = world(10, ["recall", "explain", "apply"]);
  for (const c of s.concepts) c.srs = reviewSrs(NOW - DAY);
  const plan = buildPlan(s, { now: NOW });
  assert.equal(plan.tasks.length, 10);
  assert.equal(new Set(plan.tasks.map(t => t.conceptId)).size, 10);
  for (const c of s.concepts) c.srs = reviewSrs(NOW + 2 * DAY);
  assert.equal(forecastLoad(s, { now: NOW, days: 4 }).count[2], 10);
});

test("a concept's questions take turns: basic first, then never-asked, then oldest", () => {
  let s = world(1, ["recall", "explain", "apply"]);
  const c0 = s.concepts[0];
  const ix0 = index(s);
  assert.equal(pickItem(ix0, c0).ability, "recall", "a new concept starts with its most basic question");

  let now = NOW;
  const answer = (ability) => {
    const it = s.items.find(i => i.ability === ability);
    s = reducer(s, { type: "attempt", itemId: it.id, verdict: "correct", rating: RATING.GOOD, now });
  };
  const next = () => { const c = s.concepts[0]; return pickItem(index(s), { ...c, srs: { ...c.srs, state: "review" } }).ability; };

  answer("recall"); now += 11 * 60e3; answer("recall"); // learning steps on the same question
  assert.equal(s.concepts[0].srs.state, "review");
  now += 4 * DAY;
  assert.equal(next(), "explain");
  answer("explain"); now += 10 * DAY;
  assert.equal(next(), "apply");
  answer("apply"); now += 30 * DAY;
  assert.equal(next(), "recall", "then back to the one asked longest ago");
});

test("after a miss, the same question comes back during relearning", () => {
  let s = world(1, ["recall", "explain"]);
  s.concepts[0].srs = reviewSrs(NOW);
  const explain = s.items.find(i => i.ability === "explain");
  s = reducer(s, { type: "attempt", itemId: explain.id, verdict: "incorrect", rating: RATING.AGAIN, now: NOW });
  assert.equal(s.concepts[0].srs.state, "relearning");
  assert.equal(pickItem(index(s), s.concepts[0]).id, explain.id);
  const plan = buildPlan(s, { now: NOW + 2 * 60e3 });
  assert.equal(plan.tasks[0].itemId, explain.id);
  assert.equal(plan.tasks[0].kind, "learning");
});

test("answering any of a concept's questions reschedules the whole concept", () => {
  let s = world(1, ["recall", "explain", "apply"]);
  s.concepts[0].srs = reviewSrs(NOW - DAY);
  assert.equal(buildPlan(s, { now: NOW }).tasks.length, 1);
  const recall = s.items.find(i => i.ability === "recall");
  s = reducer(s, { type: "attempt", itemId: recall.id, verdict: "correct", rating: RATING.GOOD, now: NOW });
  assert.ok(s.concepts[0].srs.due > NOW + DAY);
  assert.equal(buildPlan(s, { now: NOW + 60e3 }).tasks.length, 0, "no sibling question is left due");
});

test("misses on the same day count once toward pulling a question", () => {
  let s = world(1, ["explain"]);
  s.concepts[0].srs = reviewSrs(NOW);
  const it = s.items[0];
  for (let i = 0; i < LEECH_LAPSES + 2; i++) {
    s = reducer(s, { type: "attempt", itemId: it.id, verdict: "incorrect", rating: RATING.AGAIN, now: NOW + i * 60e3 });
  }
  assert.equal(s.items[0].flag ?? null, null);
  assert.equal(index(s).itemStats[it.id].missDays.length, 1);
});

test("saved data from before keeps its progress: the latest-reviewed question's schedule moves to the concept", () => {
  const s = world(2, ["recall", "apply"]);
  const [a, b] = s.concepts;
  const [aRecall, aApply] = s.items.filter(i => i.conceptId === a.id);
  const old = {
    ...s, version: 3,
    concepts: s.concepts.map(({ srs: _unused, ...c }) => c), // eslint-disable-line no-unused-vars
    items: s.items.map(i => ({ ...i, srs: newSrs() })),
  };
  old.items.find(i => i.id === aRecall.id).srs = { ...reviewSrs(NOW + 9 * DAY), lastReview: NOW - DAY, stability: 12 };
  old.items.find(i => i.id === aApply.id).srs = { ...reviewSrs(NOW + 2 * DAY), lastReview: NOW - 5 * DAY, stability: 4 };

  const out = normalizeState(old);
  assert.equal(out.version, 5);
  const na = out.concepts.find(c => c.id === a.id), nb = out.concepts.find(c => c.id === b.id);
  assert.equal(na.srs.stability, 12);
  assert.equal(na.srs.due, NOW + 9 * DAY);
  assert.equal(nb.srs.state, "new");
  assert.ok(out.items.every(i => !("srs" in i)));
  assert.deepEqual(normalizeState(out), out, "normalizing again changes nothing");
});
