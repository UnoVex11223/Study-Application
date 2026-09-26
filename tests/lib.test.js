import { test } from "node:test";
import assert from "node:assert/strict";

import { rate, newSrs, retrievability, RATING } from "../src/lib/fsrs.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem, makeEdge } from "../src/lib/model.js";
import { buildPlan, interleave, forecastLoad, makeLoadAt } from "../src/lib/planner.js";
import { conceptMastery, courseMastery } from "../src/lib/mastery.js";
import { wouldCycle, mergeEdges, layeredLayout, topoOrder } from "../src/lib/graph.js";
import { matchesAccepted, verdictFromChecks, suggestedRating, normalize } from "../src/lib/grade.js";
import { dayKey, dayEndTs, addDays } from "../src/lib/time.js";

const DAY = 864e5;
const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime(); // Sat 26 Sep 2026, noon local

// ── helpers ────────────────────────────────────────────────────────────────
function world({ courses = 1, sections = 1, conceptsPer = 5, abilities = ["recall"], minutes = 20, maxNew = 6 } = {}) {
  const s = emptyState();
  s.settings.dailyMinutes = minutes;
  s.settings.maxNewPerDay = maxNew;
  for (let c = 0; c < courses; c++) {
    const course = makeCourse({ name: `Course ${c}` }, c);
    s.courses.push(course);
    for (let si = 0; si < sections; si++) {
      const sec = makeSection({ courseId: course.id, title: `S${si}`, order: si });
      s.sections.push(sec);
      for (let k = 0; k < conceptsPer; k++) {
        const concept = makeConcept({ courseId: course.id, sectionId: sec.id, name: `C${c}-${si}-${k}`, order: k });
        s.concepts.push(concept);
        for (const ab of abilities) s.items.push(makeItem({ conceptId: concept.id, ability: ab, prompt: "q", answer: "a" }));
      }
    }
  }
  return s;
}

/** Put every item into review state, due `dueOffsetDays` from NOW. */
function makeAllDue(s, { dueOffsetDays = -1, stability = 5 } = {}) {
  for (const it of s.items) {
    it.srs = { ...newSrs(), state: "review", stability, difficulty: 5, lastReview: NOW - 6 * DAY, due: NOW + dueOffsetDays * DAY, reps: 3 };
  }
}

// ── time ───────────────────────────────────────────────────────────────────
test("study day rolls over at 4am, not midnight", () => {
  const lateNight = new Date(2026, 8, 27, 1, 30).getTime(); // 1:30am Sunday
  assert.equal(dayKey(lateNight, 4), "2026-09-26");
  assert.equal(dayKey(new Date(2026, 8, 27, 4, 1).getTime(), 4), "2026-09-27");
  assert.equal(dayEndTs(NOW, 4), new Date(2026, 8, 27, 4, 0).getTime());
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
});

// ── FSRS ───────────────────────────────────────────────────────────────────
test("FSRS: new → learning → review, and lapses count", () => {
  let s = rate(newSrs(), RATING.GOOD, NOW);
  assert.equal(s.state, "learning");
  s = rate(s, RATING.GOOD, NOW + 600e3);
  assert.equal(s.state, "review");
  assert.ok(s.due > NOW + DAY);
  const later = s.due;
  s = rate(s, RATING.AGAIN, later);
  assert.equal(s.state, "relearning");
  assert.equal(s.lapses, 1);
  assert.ok(retrievability({ ...s, state: "review" }, later + DAY) < 1);
});

test("FSRS load balancing picks the emptiest day in the fuzz window", () => {
  const srs = { ...newSrs(), state: "review", stability: 30, difficulty: 5, lastReview: NOW - 30 * DAY, due: NOW, reps: 4 };
  const busy = (ts) => Math.round((ts - NOW) / DAY) === 36 ? 0 : 50;
  const out = rate(srs, RATING.GOOD, NOW, { loadAt: busy, random: () => 0 });
  const days = Math.round((out.due - NOW) / DAY);
  // Only pick day 36 if it's inside the window; otherwise all days tie.
  const plain = rate(srs, RATING.GOOD, NOW, { random: () => 0.5 });
  const center = Math.round((plain.due - NOW) / DAY);
  if (Math.abs(center - 36) <= Math.max(1, Math.round(center * 0.05))) assert.equal(days, 36);
  assert.ok(Math.abs(days - center) <= Math.max(1, Math.round(center * 0.05)) + 1);
});

test("higher target retention gives shorter intervals", () => {
  const srs = { ...newSrs(), state: "review", stability: 20, difficulty: 5, lastReview: NOW - 20 * DAY, due: NOW, reps: 4 };
  const lo = rate(srs, RATING.GOOD, NOW, { retention: 0.85, random: () => 0.5 }).due;
  const hi = rate(srs, RATING.GOOD, NOW, { retention: 0.95, random: () => 0.5 }).due;
  assert.ok(hi < lo);
});

// ── planner ────────────────────────────────────────────────────────────────
test("plan fits the daily time budget and defers the rest", () => {
  const s = world({ conceptsPer: 100, minutes: 10 });
  makeAllDue(s);
  const plan = buildPlan(s, { now: NOW });
  assert.ok(plan.estSec <= 10 * 60, `est ${plan.estSec}`);
  assert.equal(plan.tasks.length + plan.deferred, 100);
  assert.ok(plan.deferred > 0);
  assert.equal(plan.newCount, 0);
  assert.equal(plan.throttle, "backlog");
});

test("one task per concept per day (siblings buried)", () => {
  const s = world({ conceptsPer: 4, abilities: ["recall", "explain", "apply"], minutes: 60 });
  makeAllDue(s);
  const plan = buildPlan(s, { now: NOW });
  const concepts = plan.tasks.map(t => t.conceptId);
  assert.equal(new Set(concepts).size, concepts.length);
  assert.equal(plan.tasks.length, 4);
});

test("most-forgotten and most-important items come first when budget is tight", () => {
  const s = world({ conceptsPer: 3, minutes: 1 });
  makeAllDue(s);
  const [a, b, c] = s.concepts;
  a.importance = "detail"; b.importance = "core"; c.importance = "core";
  const itemOf = (k) => s.items.find(i => i.conceptId === k.id);
  itemOf(c).srs.lastReview = NOW - 60 * DAY; // much more forgotten
  const plan = buildPlan(s, { now: NOW });
  assert.equal(plan.tasks[0].conceptId, c.id);
  assert.ok(!plan.tasks.some(t => t.conceptId === a.id) || plan.tasks.length === 3);
});

test("new concepts respect the daily cap and budget", () => {
  const s = world({ conceptsPer: 30, minutes: 60, maxNew: 5 });
  const plan = buildPlan(s, { now: NOW });
  assert.equal(plan.newCount, 5);
  assert.ok(plan.estSec <= 60 * 60);
});

test("new intake is gated by prerequisites (knowledge frontier)", () => {
  const s = world({ conceptsPer: 3, minutes: 60, maxNew: 10 });
  const [a, b, c] = s.concepts;
  s.edges.push(makeEdge({ type: "prereq", from: a.id, to: b.id, confidence: 0.9 }));
  s.edges.push(makeEdge({ type: "prereq", from: b.id, to: c.id, confidence: 0.9 }));
  const plan = buildPlan(s, { now: NOW });
  const picked = plan.tasks.map(t => t.conceptId);
  assert.deepEqual(picked, [a.id]);
});

test("provisional (low-confidence) prerequisites don't block progress", () => {
  const s = world({ conceptsPer: 2, minutes: 60, maxNew: 10 });
  const [a, b] = s.concepts;
  s.edges.push(makeEdge({ type: "prereq", from: a.id, to: b.id, confidence: 0.3 }));
  const plan = buildPlan(s, { now: NOW });
  assert.equal(plan.newCount, 2);
});

test("new concepts are spread across active courses; paused and maintained courses get none", () => {
  const s = world({ courses: 4, conceptsPer: 10, minutes: 120, maxNew: 6 });
  s.courses[2].status = "maintain";
  s.courses[3].status = "paused";
  const plan = buildPlan(s, { now: NOW });
  const byCourse = {};
  for (const t of plan.tasks) byCourse[t.courseId] = (byCourse[t.courseId] || 0) + 1;
  assert.equal(byCourse[s.courses[0].id], 3);
  assert.equal(byCourse[s.courses[1].id], 3);
  assert.equal(byCourse[s.courses[2].id], undefined);
  assert.equal(byCourse[s.courses[3].id], undefined);
});

test("paused courses are excluded from reviews too", () => {
  const s = world({ courses: 2, conceptsPer: 5, minutes: 60 });
  makeAllDue(s);
  s.courses[1].status = "paused";
  const plan = buildPlan(s, { now: NOW });
  assert.ok(plan.tasks.every(t => t.courseId === s.courses[0].id));
});

test("a heavy upcoming week throttles new material", () => {
  const s = world({ conceptsPer: 200, minutes: 10, maxNew: 6 });
  // Lots of reviews spread over the next week, none due today.
  s.items.forEach((it, i) => {
    it.srs = { ...newSrs(), state: "review", stability: 5, difficulty: 5, lastReview: NOW - DAY, due: NOW + (1 + (i % 7)) * DAY, reps: 2 };
  });
  s.items.slice(0, 5).forEach(it => { it.srs = newSrs(); });
  const plan = buildPlan(s, { now: NOW });
  assert.equal(plan.newCount, 0);
  assert.equal(plan.throttle, "forecast");
});

test("time already studied today reduces the remaining budget", () => {
  const s = world({ conceptsPer: 50, minutes: 10 });
  makeAllDue(s);
  const today = dayKey(NOW, 4);
  for (let i = 0; i < 9; i++) {
    s.attempts.push({ ts: NOW - 1000 * (i + 1), day: today, itemId: "x", conceptId: "x", courseId: "x", ability: "recall", verdict: "correct", rating: 3, aided: false, mode: "session", ms: 60e3 });
  }
  // A single runaway attempt (left the app open) is capped at 5 minutes.
  s.attempts.push({ ts: NOW - 20000, day: addDays(today, -1), itemId: "y", conceptId: "y", courseId: "x", ability: "recall", verdict: "correct", rating: 3, aided: false, mode: "session", ms: 3600e3 });
  const plan = buildPlan(s, { now: NOW });
  assert.ok(plan.budgetSec <= 60);
  const s2 = { ...s, days: { [today]: { extraSec: 300 } } };
  assert.ok(buildPlan(s2, { now: NOW }).budgetSec > 300);
});

test("learning steps due soon always make it into the plan", () => {
  const s = world({ conceptsPer: 20, minutes: 0 });
  s.items[0].srs = { ...newSrs(), state: "relearning", stability: 1, difficulty: 6, lastReview: NOW - 120e3, due: NOW - 60e3, reps: 4, lapses: 1 };
  const plan = buildPlan(s, { now: NOW });
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].kind, "learning");
});

test("interleave alternates courses and spaces new tasks between reviews", () => {
  const r = [1, 2, 3, 4].map(i => ({ courseId: i % 2 ? "A" : "B", kind: "review", id: i }));
  const f = [5, 6].map(i => ({ courseId: "A", kind: "new", id: i }));
  const out = interleave(r, f);
  assert.deepEqual(out.map(t => t.kind), ["review", "review", "new", "review", "review", "new"]);
  assert.notEqual(out[0].courseId, out[1].courseId);
});

test("forecast and load map count scheduled reviews", () => {
  const s = world({ conceptsPer: 3 });
  makeAllDue(s, { dueOffsetDays: 2 });
  const { count } = forecastLoad(s, { now: NOW, days: 5 });
  assert.equal(count[2], 3);
  assert.equal(makeLoadAt(s)(NOW + 2 * DAY), 3);
});

// ── mastery ────────────────────────────────────────────────────────────────
function attempt(concept, item, dayOffset, verdict, extra = {}) {
  const ts = NOW + dayOffset * DAY;
  return { ts, day: dayKey(ts, 4), itemId: item.id, conceptId: concept.id, courseId: concept.courseId, ability: item.ability, verdict, rating: verdict === "correct" ? 3 : 1, aided: false, mode: "session", ms: 20000, ...extra };
}

test("mastery needs unaided success on two different days", () => {
  const s = world({ conceptsPer: 1 });
  const [c] = s.concepts; const [it] = s.items;
  it.srs = { ...newSrs(), state: "review", stability: 3, difficulty: 5, lastReview: NOW, due: NOW + 3 * DAY, reps: 2 };
  s.attempts.push(attempt(c, it, -1, "correct"), attempt(c, it, -1, "correct"));
  assert.equal(conceptMastery(s, c.id, NOW).status, "practiced");
  const s2 = { ...s, attempts: [...s.attempts, attempt(c, it, 0, "correct")] };
  assert.equal(conceptMastery(s2, c.id, NOW).status, "mastered");
});

test("hints and revealed answers never count as mastery evidence", () => {
  const s = world({ conceptsPer: 1 });
  const [c] = s.concepts; const [it] = s.items;
  it.srs = { ...newSrs(), state: "review", stability: 3, difficulty: 5, lastReview: NOW, due: NOW + 3 * DAY, reps: 2 };
  s.attempts.push(attempt(c, it, -3, "correct", { aided: true }), attempt(c, it, -2, "correct", { aided: true }), attempt(c, it, -1, "correct"));
  const m = conceptMastery(s, c.id, NOW);
  assert.equal(m.correctDays, 1);
  assert.notEqual(m.status, "mastered");
});

test("concepts with an application task need a correct application to be mastered", () => {
  const s = world({ conceptsPer: 1, abilities: ["recall", "apply"] });
  const [c] = s.concepts; const [rec, app] = s.items;
  for (const it of s.items) it.srs = { ...newSrs(), state: "review", stability: 3, difficulty: 5, lastReview: NOW, due: NOW + 3 * DAY, reps: 2 };
  s.attempts.push(attempt(c, rec, -2, "correct"), attempt(c, rec, -1, "correct"));
  assert.equal(conceptMastery(s, c.id, NOW).status, "practiced");
  s.attempts.push(attempt(c, app, 0, "correct"));
  const s2 = { ...s, attempts: [...s.attempts] };
  assert.equal(conceptMastery(s2, c.id, NOW).status, "mastered");
});

test("one good day after a miss isn't mastery; two good days in a row are", () => {
  const s = world({ conceptsPer: 1 });
  const [c] = s.concepts; const [it] = s.items;
  it.srs = { ...newSrs(), state: "review", stability: 3, difficulty: 5, lastReview: NOW, due: NOW + 3 * DAY, reps: 5, lapses: 2 };
  s.attempts.push(attempt(c, it, -5, "correct"), attempt(c, it, -4, "correct"), attempt(c, it, -2, "incorrect"), attempt(c, it, -1, "correct"));
  const m = conceptMastery(s, c.id, NOW);
  assert.equal(m.status, "practiced");
  const s2 = { ...s, attempts: [...s.attempts, attempt(c, it, 0, "correct")] };
  assert.equal(conceptMastery(s2, c.id, NOW).status, "mastered");
});

test("a miss after success marks a concept as slipping", () => {
  const s = world({ conceptsPer: 1 });
  const [c] = s.concepts; const [it] = s.items;
  it.srs = { ...newSrs(), state: "relearning", stability: 1, difficulty: 6, lastReview: NOW, due: NOW, reps: 3, lapses: 1 };
  s.attempts.push(attempt(c, it, -3, "correct"), attempt(c, it, -2, "correct"), attempt(c, it, 0, "incorrect"));
  assert.equal(conceptMastery(s, c.id, NOW).status, "slipping");
});

test("course mastery uses core concepts as the denominator", () => {
  const s = world({ conceptsPer: 4 });
  s.concepts[3].importance = "detail";
  const m = courseMastery(s, s.courses[0].id, NOW);
  assert.equal(m.basisCount, 3);
  assert.equal(m.total, 4);
});

// ── graph ──────────────────────────────────────────────────────────────────
test("prerequisite cycles are rejected; related edges may loop", () => {
  const e = (from, to, type = "prereq") => ({ from, to, type });
  const edges = [e("a", "b"), e("b", "c")];
  assert.equal(wouldCycle(edges, "c", "a"), true);
  assert.equal(wouldCycle(edges, "a", "c"), false);
  const { accepted, rejected } = mergeEdges(edges, [e("c", "a"), e("a", "c"), e("c", "a", "related"), e("a", "b")]);
  assert.equal(accepted.length, 2);
  assert.deepEqual(rejected.map(r => r.reason).sort(), ["cycle", "duplicate"]);
});

test("layered layout puts prerequisites to the left", () => {
  const nodes = ["a", "b", "c", "d"].map(id => ({ id }));
  const edges = [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "d" }];
  const { pos } = layeredLayout(nodes, edges);
  assert.ok(pos.a.x < pos.b.x && pos.b.x < pos.c.x);
  assert.equal(pos.b.layer, pos.d.layer);
  assert.deepEqual(topoOrder(["c", "b", "a"], edges.map(x => ({ ...x, type: "prereq" }))), ["a", "b", "c"]);
});

// ── grading ────────────────────────────────────────────────────────────────
test("accepted-answer matching tolerates case, articles and small typos", () => {
  assert.equal(normalize("The  Heap!"), "heap");
  assert.ok(matchesAccepted("the heap", ["Heap"]));
  assert.ok(matchesAccepted("magic numbr", ["magic number"]));
  assert.ok(!matchesAccepted("stack", ["heap"]));
  assert.ok(!matchesAccepted("", ["heap"]));
});

test("rubric checks map to verdicts and ratings", () => {
  assert.equal(verdictFromChecks([true, true]), "correct");
  assert.equal(verdictFromChecks([true, false]), "partial");
  assert.equal(verdictFromChecks([true, true], 1), "incorrect");
  assert.equal(verdictFromChecks([false, false]), "incorrect");
  assert.equal(suggestedRating("correct"), RATING.GOOD);
  assert.equal(suggestedRating("correct", { aided: true }), RATING.HARD);
  assert.equal(suggestedRating("incorrect"), RATING.AGAIN);
});
