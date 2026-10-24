import { test } from "node:test";
import assert from "node:assert/strict";

import { rate, newSrs, retrievability, intervalDays, RATING } from "../src/lib/fsrs.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem, makeEdge } from "../src/lib/model.js";
import { buildPlan } from "../src/lib/planner.js";

const DAY = 864e5;
const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime();

/** Courses with `n` concepts each, all with one recall question. */
function library(sizes, { perDay = 20, maxNew = 6, mix } = {}) {
  const s = emptyState();
  s.settings.dailyQuestions = perDay;
  s.settings.maxNewPerDay = maxNew;
  if (mix) s.settings.mix = mix;
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
/** Due today and still well remembered (recall ≈ 0.89, above the slip line). */
const dueWell = (c, extra = {}) => { c.srs = { ...newSrs(), state: "review", stability: 5, difficulty: 5, lastReview: NOW - 6 * DAY, due: NOW - DAY, reps: 3, ...extra }; };
/** Due and slipping (recall well under 0.85). */
const dueSlipping = (c) => { c.srs = { ...newSrs(), state: "review", stability: 2, difficulty: 6, lastReview: NOW - 40 * DAY, due: NOW - 30 * DAY, reps: 3 }; };
const countBy = (s, plan) => {
  const out = s.courses.map(() => 0);
  for (const t of plan.tasks) out[s.courses.findIndex(c => c.id === t.courseId)]++;
  return out;
};

// ── FSRS-6 ──────────────────────────────────────────────────────────────────
test("FSRS-6: recall is 90% after `stability` days, so old schedules keep their due dates", () => {
  const srs = { ...newSrs(), state: "review", stability: 12, difficulty: 5, lastReview: NOW, due: NOW + 12 * DAY, reps: 3 };
  assert.ok(Math.abs(retrievability(srs, NOW + 12 * DAY) - 0.9) < 1e-9);
  assert.equal(intervalDays(12, 0.9), 12);
});

test("FSRS-6: same-day reviews change stability (learning steps count)", () => {
  const first = rate(newSrs(), RATING.HARD, NOW);
  const again = rate(first, RATING.AGAIN, NOW + 5 * 60e3);
  const good = rate(first, RATING.GOOD, NOW + 5 * 60e3);
  assert.ok(again.stability < first.stability, "a miss on the same day lowers stability");
  assert.ok(good.stability >= first.stability, "a success never lowers it");
  assert.equal(good.state, "learning");
});

test("FSRS-6: a lapse leaves stability lower than before, and difficulty rises", () => {
  const srs = { ...newSrs(), state: "review", stability: 30, difficulty: 5, lastReview: NOW - 30 * DAY, due: NOW, reps: 6 };
  const out = rate(srs, RATING.AGAIN, NOW);
  assert.equal(out.state, "relearning");
  assert.ok(out.stability < 30);
  assert.ok(out.difficulty > 5);
  const easy = rate(srs, RATING.EASY, NOW, { random: () => 0.5 });
  assert.ok(easy.difficulty < 5 && easy.stability > 30);
});

// ── An even mix ─────────────────────────────────────────────────────────────
test("an even mix: a big course doesn't crowd out the others", () => {
  const s = library([60, 30], { maxNew: 0 });
  conceptsOf(s, 0).forEach(c => dueWell(c, { lastReview: NOW - 6.5 * DAY })); // a little more urgent
  conceptsOf(s, 1).slice(0, 12).forEach(c => dueWell(c));
  const plan = buildPlan(s, { now: NOW });
  assert.deepEqual(countBy(s, plan), [10, 10]);
  assert.equal(plan.deferred, 52);

  const byDue = buildPlan({ ...s, settings: { ...s.settings, mix: "due" } }, { now: NOW });
  assert.deepEqual(countBy(s, byDue), [20, 0], "by what's due, the most urgent anywhere win");
});

test("a course with less due gives its turns to the others", () => {
  const s = library([60, 30], { maxNew: 0 });
  conceptsOf(s, 0).forEach(c => dueWell(c));
  conceptsOf(s, 1).slice(0, 3).forEach(c => dueWell(c));
  assert.deepEqual(countBy(s, buildPlan(s, { now: NOW })), [17, 3]);
});

test("slipping reviews are never held back for the mix", () => {
  const s = library([30, 30], { maxNew: 0 });
  conceptsOf(s, 0).slice(0, 15).forEach(dueSlipping);
  conceptsOf(s, 1).slice(0, 15).forEach(c => dueWell(c));
  const plan = buildPlan(s, { now: NOW });
  assert.deepEqual(countBy(s, plan), [15, 5]);
  const ids = new Set(plan.tasks.map(t => t.conceptId));
  assert.ok(conceptsOf(s, 0).slice(0, 15).every(c => ids.has(c.id)));
});

test("a slipping review that doesn't fit stops new material everywhere", () => {
  const s = library([40, 10], { perDay: 10 });
  conceptsOf(s, 0).slice(0, 15).forEach(dueSlipping);
  const plan = buildPlan(s, { now: NOW });
  assert.equal(plan.newCount, 0);
  assert.equal(plan.throttle, "backlog");
});

test("new concepts still come into a course with no backlog of its own", () => {
  const s = library([60, 10]);
  conceptsOf(s, 0).forEach(c => dueWell(c));
  const plan = buildPlan(s, { now: NOW });
  const fresh = plan.tasks.filter(t => t.kind === "new");
  assert.ok(fresh.length > 0 && fresh.every(t => t.courseId === s.courses[1].id));
  assert.equal(fresh.length, 6, "up to the daily cap; the rest of its turns go back to the reviews");
  assert.deepEqual(countBy(s, plan), [14, 6]);
});

test("maintained courses take their turn with reviews; paused ones are left out", () => {
  const s = library([40, 20, 20], { maxNew: 0 });
  s.courses[1].status = "maintain";
  s.courses[2].status = "paused";
  s.concepts.forEach(c => dueWell(c));
  assert.deepEqual(countBy(s, buildPlan(s, { now: NOW })), [10, 10, 0]);
});

test("filling the day: courses take turns, reaching past two weeks if they must", () => {
  const s = library([30, 10], { maxNew: 0 });
  conceptsOf(s, 0).forEach((c, i) => { c.srs = { ...newSrs(), state: "review", stability: 10, difficulty: 5, lastReview: NOW - 5 * DAY, due: NOW + (2 + (i % 5)) * DAY, reps: 3 }; });
  conceptsOf(s, 1).forEach((c, i) => { c.srs = { ...newSrs(), state: "review", stability: 60, difficulty: 5, lastReview: NOW - (5 + i) * DAY, due: NOW + 40 * DAY, reps: 4 }; });
  const plan = buildPlan(s, { now: NOW });
  assert.equal(plan.tasks.length, 20);
  assert.deepEqual(countBy(s, plan), [10, 10]);
  // The far-off ones go longest-unseen first.
  const picked = new Set(plan.tasks.map(t => t.conceptId));
  assert.ok(conceptsOf(s, 1).every(c => picked.has(c.id)));
});

// ── Easily confused ideas, back to back ─────────────────────────────────────
test("two ideas marked 'easily confused' are asked one after the other", () => {
  const s = library([12, 12], { maxNew: 0 });
  s.concepts.forEach(c => dueWell(c));
  const a = conceptsOf(s, 0)[0], b = conceptsOf(s, 1)[9];
  s.edges.push(makeEdge({ type: "contrast", from: a.id, to: b.id, confidence: 0.9, why: "Both hold an address." }));
  const order = buildPlan(s, { now: NOW }).tasks.map(t => t.conceptId);
  const i = order.indexOf(a.id), j = order.indexOf(b.id);
  assert.ok(i >= 0 && j >= 0);
  assert.equal(Math.abs(i - j), 1);
});

test("filling the day pulls in the partner of an idea that's already in it", () => {
  const s = library([5, 30], { maxNew: 0, perDay: 6 });
  const due = conceptsOf(s, 0)[0];
  dueWell(due);
  conceptsOf(s, 1).forEach((c, i) => { c.srs = { ...newSrs(), state: "review", stability: 10, difficulty: 5, lastReview: NOW - 2 * DAY, due: NOW + (1 + i % 3) * DAY, reps: 3 }; });
  const partner = conceptsOf(s, 1)[29];
  partner.srs.due = NOW + 12 * DAY;
  s.edges.push(makeEdge({ type: "contrast", from: due.id, to: partner.id, confidence: 0.9 }));
  const plan = buildPlan(s, { now: NOW });
  const order = plan.tasks.map(t => t.conceptId);
  assert.ok(order.includes(partner.id));
  assert.equal(Math.abs(order.indexOf(due.id) - order.indexOf(partner.id)), 1);
});
