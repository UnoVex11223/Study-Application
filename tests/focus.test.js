// One course for the day: Today lets you build the day's session from every
// course (the mix) or from a single one (settings.focusCourseId).
import { test } from "node:test";
import assert from "node:assert/strict";

import { newSrs } from "../src/lib/fsrs.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem, normalizeState } from "../src/lib/model.js";
import { buildPlan } from "../src/lib/planner.js";
import { reducer } from "../src/state/reducer.js";

const DAY = 864e5;
const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime();

/** Courses with `n` concepts each, all with one recall question. */
function library(sizes, { perDay = 20, maxNew = 6 } = {}) {
  const s = emptyState();
  s.settings.dailyQuestions = perDay;
  s.settings.maxNewPerDay = maxNew;
  sizes.forEach((n, ci) => {
    const course = makeCourse({ name: `Course ${ci}` }, ci);
    s.courses.push(course);
    const sec = makeSection({ courseId: course.id, order: 0 });
    s.sections.push(sec);
    for (let k = 0; k < n; k++) {
      const c = makeConcept({ courseId: course.id, sectionId: sec.id, name: `${ci}-${k}`, order: k });
      s.concepts.push(c);
      s.items.push(makeItem({ conceptId: c.id, prompt: "q", answer: "a" }));
    }
  });
  return s;
}
const conceptsOf = (s, ci) => s.concepts.filter(c => c.courseId === s.courses[ci].id);
const review = (c, dueIn) => { c.srs = { ...newSrs(), state: "review", stability: 5, difficulty: 5, lastReview: NOW - 6 * DAY, due: NOW + dueIn * DAY, reps: 3 }; };
const coursesIn = (s, plan) => [...new Set(plan.tasks.map(t => s.courses.findIndex(c => c.id === t.courseId)))].sort();

test("with one course chosen, the whole day comes from it, and the reviews due elsewhere are counted", () => {
  const s = library([30, 30]);
  conceptsOf(s, 0).slice(0, 25).forEach((c, i) => review(c, i < 4 ? -1 : 3)); // 4 due, 21 coming up
  conceptsOf(s, 1).slice(0, 7).forEach(c => review(c, -1)); // 7 due in the other course

  const all = buildPlan(s, { now: NOW });
  assert.equal(all.focus, null);
  assert.equal(all.elsewhere, 0);
  assert.deepEqual(coursesIn(s, all), [0, 1], "every course by default");

  const one = buildPlan(s, { now: NOW, focus: s.courses[0].id });
  assert.equal(one.focus, s.courses[0].id);
  assert.deepEqual(coursesIn(s, one), [0]);
  assert.equal(one.tasks.length, 20, "the day is still full: its due reviews, new concepts, then what's coming up");
  assert.equal(one.elsewhere, 7, "the other course's due reviews wait, and the plan says how many");
  assert.deepEqual(one.byCourse.map(b => b.count), [20]);
});

test("the choice is kept in settings, and passing one overrides it", () => {
  let s = library([10, 10]);
  for (const c of s.concepts) review(c, -1);
  s = reducer(s, { type: "settings", patch: { focusCourseId: s.courses[1].id }, now: NOW });
  assert.deepEqual(coursesIn(s, buildPlan(s, { now: NOW })), [1], "Today's choice is what the day is built from");
  assert.deepEqual(coursesIn(s, buildPlan(s, { now: NOW, focus: null })), [0, 1], "null asks for every course");
  assert.deepEqual(coursesIn(s, buildPlan(s, { now: NOW, focus: s.courses[0].id })), [0]);
  assert.equal(normalizeState(emptyState()).settings.focusCourseId, null, "every course until you choose");
});

test("a chosen course that's gone or paused is ignored", () => {
  const s = library([10, 10]);
  for (const c of s.concepts) review(c, -1);
  assert.equal(buildPlan(s, { now: NOW, focus: "no-such-course" }).focus, null);
  assert.deepEqual(coursesIn(s, buildPlan(s, { now: NOW, focus: "no-such-course" })), [0, 1]);
  s.courses[0].status = "paused";
  const plan = buildPlan(s, { now: NOW, focus: s.courses[0].id });
  assert.equal(plan.focus, null);
  assert.deepEqual(coursesIn(s, plan), [1]);
});

test("one course doesn't lift the daily cap on new concepts", () => {
  const s = library([40, 5], { maxNew: 6 });
  const plan = buildPlan(s, { now: NOW, focus: s.courses[0].id });
  assert.equal(plan.tasks.length, 6);
  assert.ok(plan.tasks.every(t => t.kind === "new"));
  assert.equal(plan.short, true, "a new course can't fill the day on its own");
});
