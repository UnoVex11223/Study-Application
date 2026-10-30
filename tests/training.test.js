import { test } from "node:test";
import assert from "node:assert/strict";

import { newSrs, rate, retrievability, implicitReview, RATING } from "../src/lib/fsrs.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem, makeEdge, index } from "../src/lib/model.js";
import { reducer } from "../src/state/reducer.js";
import { suggestedRating } from "../src/lib/grade.js";
import {
  implicitCredit, typicalPace, isSlow, pretestTasks, sectionStarted, activationForecast, wantsFreshVersion,
} from "../src/lib/training.js";
import { codeOf, guessLang, hasTests } from "../src/lib/code.js";
import { buildPlan } from "../src/lib/planner.js";

const DAY = 864e5;
const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();

const reviewSrs = ({ stability = 10, daysAgo = 10 } = {}) => ({
  ...newSrs(), state: "review", stability, difficulty: 5, lastReview: NOW - daysAgo * DAY, due: NOW - daysAgo * DAY + stability * DAY, reps: 3,
});

/** One course: a basic concept B and an advanced one A that builds on it. */
function world({ confidence = 0.8, basic = reviewSrs(), advanced = reviewSrs({ daysAgo: 12 }) } = {}) {
  const s = emptyState();
  const course = makeCourse({ name: "C" });
  const sec = makeSection({ courseId: course.id, title: "S" });
  const B = makeConcept({ courseId: course.id, sectionId: sec.id, name: "Basic", order: 0, srs: basic });
  const A = makeConcept({ courseId: course.id, sectionId: sec.id, name: "Advanced", order: 1, srs: advanced });
  const iB = makeItem({ conceptId: B.id, ability: "explain", prompt: "Explain B", answer: "b", points: ["b"] });
  const iA = makeItem({ conceptId: A.id, ability: "apply", prompt: "Apply A", answer: "a", points: ["a"] });
  s.courses.push(course); s.sections.push(sec); s.concepts.push(B, A); s.items.push(iB, iA);
  s.edges.push(makeEdge({ type: "prereq", from: B.id, to: A.id, confidence }));
  return { s, course, sec, A, B, iA, iB };
}

// ── Implicit review ──────────────────────────────────────────────────────────

test("implicit review: a memory close to due gets real credit, its last review stays the anchor", () => {
  const srs = reviewSrs({ stability: 10, daysAgo: 10 }); // due today
  const out = implicitReview(srs, NOW);
  assert.ok(out.stability > srs.stability);
  assert.ok(out.due > srs.due, "the next review moves out");
  assert.equal(out.lastReview, srs.lastReview);
  assert.equal(out.reps, srs.reps, "it isn't counted as a review");
  // Less than a real Good review would give.
  const full = rate(srs, RATING.GOOD, NOW, { random: () => 0.5 });
  assert.ok(out.stability < full.stability);
  assert.ok(retrievability(out, NOW) > retrievability(srs, NOW));
});

test("implicit review: little credit for a fresh memory, none twice a day, none for new or same-day", () => {
  const fresh = reviewSrs({ stability: 30, daysAgo: 2 });
  const out = implicitReview(fresh, NOW);
  assert.ok(out.stability - fresh.stability < 0.15 * fresh.stability, "recently reviewed: close to nothing");
  assert.ok(out.due >= fresh.due, "never brings a review forward");

  const once = implicitReview(reviewSrs(), NOW);
  assert.equal(implicitReview(once, NOW + 3600e3), once, "at most once a day");
  assert.equal(implicitReview(newSrs(), NOW).state, "new");
  const today = { ...reviewSrs(), lastReview: NOW - 3600e3 };
  assert.equal(implicitReview(today, NOW), today);
  const learning = { ...reviewSrs(), state: "learning" };
  assert.equal(implicitReview(learning, NOW), learning);
});

test("a right answer on an advanced concept partly reviews its prerequisite", () => {
  const { s, B, iA } = world();
  const before = s.concepts.find(c => c.id === B.id).srs;
  const next = reducer(s, { type: "attempt", itemId: iA.id, verdict: "correct", rating: RATING.GOOD, now: NOW });
  const after = next.concepts.find(c => c.id === B.id).srs;
  assert.ok(after.stability > before.stability);
  assert.ok(after.due > before.due);
  assert.deepEqual(next.attempts.at(-1).credited, [B.id]);
  assert.equal(next.attempts.filter(a => a.conceptId === B.id).length, 0, "it isn't logged as an answer to the prerequisite");
});

test("no prerequisite credit for help, misses, Hard, or links that aren't confirmed", () => {
  const check = (w, action) => {
    const before = w.s.concepts.find(c => c.id === w.B.id).srs;
    const next = reducer(w.s, { type: "attempt", itemId: w.iA.id, now: NOW, ...action });
    return next.concepts.find(c => c.id === w.B.id).srs === before;
  };
  assert.ok(check(world(), { verdict: "correct", rating: RATING.HARD, aided: true }));
  assert.ok(check(world(), { verdict: "incorrect", rating: RATING.AGAIN }));
  assert.ok(check(world(), { verdict: "partial", rating: RATING.HARD }));
  assert.ok(check(world({ confidence: 0.45 }), { verdict: "correct", rating: RATING.GOOD }));
  assert.equal(Object.keys(implicitCredit(world({ basic: newSrs() }).s, world().A.id, NOW)).length, 0, "a prerequisite not started yet gets nothing");
});

// ── Recording what happened ──────────────────────────────────────────────────

test("an answer records answer time, confidence, why you missed it, and the rest", () => {
  const { s, iB } = world();
  const next = reducer(s, {
    type: "attempt", itemId: iB.id, verdict: "incorrect", rating: RATING.AGAIN, now: NOW, ms: 50000,
    answerMs: 21000.4, sure: true, reason: "misconception", variant: true, tests: "failed", probe: { depth: 1, broke: true },
  });
  const a = next.attempts.at(-1);
  assert.equal(a.answerMs, 21000);
  assert.equal(a.sure, true);
  assert.equal(a.reason, "misconception");
  assert.equal(a.variant, true);
  assert.equal(a.tests, "failed");
  assert.deepEqual(a.probe, { depth: 1, broke: true });
  const plain = reducer(s, { type: "attempt", itemId: iB.id, verdict: "correct", rating: RATING.GOOD, now: NOW }).attempts.at(-1);
  for (const k of ["answerMs", "sure", "reason", "variant", "tests", "probe", "slow"]) assert.ok(!(k in plain), `${k} is only stored when there is one`);
});

test("pretests never touch the schedule or the log", () => {
  const { s, iB } = world({ basic: newSrs() });
  const next = reducer(s, { type: "attempt", itemId: iB.id, verdict: "incorrect", rating: RATING.AGAIN, mode: "pretest", now: NOW });
  assert.equal(next, s);
});

// ── Ratings ──────────────────────────────────────────────────────────────────

test("suggested rating: slow and helped answers are Hard, a slip is Hard, a wrong belief is Again", () => {
  assert.equal(suggestedRating("correct"), RATING.GOOD);
  assert.equal(suggestedRating("correct", { slow: true }), RATING.HARD);
  assert.equal(suggestedRating("correct", { aided: true }), RATING.HARD);
  assert.equal(suggestedRating("incorrect"), RATING.AGAIN);
  assert.equal(suggestedRating("incorrect", { reason: "slip" }), RATING.HARD);
  assert.equal(suggestedRating("incorrect", { reason: "slip", aided: true }), RATING.AGAIN, "you can't slip on something you looked up");
  assert.equal(suggestedRating("partial"), RATING.HARD);
  assert.equal(suggestedRating("partial", { reason: "misconception" }), RATING.AGAIN);
  assert.equal(suggestedRating("partial", { reason: "unlearned" }), RATING.AGAIN);
  assert.equal(suggestedRating("incorrect", { reason: "forgot" }), RATING.AGAIN);
});

// ── Pace ─────────────────────────────────────────────────────────────────────

test("pace: your own median once there's enough history; slow is well over it", () => {
  const mk = (ms, extra = {}) => ({ ability: "explain", verdict: "correct", aided: false, answerMs: ms, ...extra });
  const few = [mk(20000), mk(30000)];
  assert.equal(typicalPace(few, "explain"), null);
  const many = [20, 22, 24, 26, 28, 30, 32, 34, 36].map(s => mk(s * 1000));
  many.push(mk(1000, { aided: true }), mk(1000, { verdict: "incorrect" }), { ability: "recall", verdict: "correct", answerMs: 1000 });
  assert.equal(typicalPace(many, "explain"), 28000);
  assert.equal(isSlow(60000, "explain", 28000), true);
  assert.equal(isSlow(55000, "explain", 28000), false, "under twice your usual time");
  assert.equal(isSlow(40000, "recall", 5000), true, "a quick kind of question: 30 seconds over still counts");
  assert.equal(isSlow(30000, "recall", 5000), false);
  // Without history: a generous allowance by question type.
  assert.equal(isSlow(60000, "recall"), false);
  assert.equal(isSlow(80000, "recall"), true);
  assert.equal(isSlow(0, "recall"), false);
});

// ── Pretests ─────────────────────────────────────────────────────────────────

test("pretest: core ideas first, one basic question each; not offered once a section is started", () => {
  const s = emptyState();
  const course = makeCourse({ name: "C" });
  const sec = makeSection({ courseId: course.id, title: "Ch 1" });
  s.courses.push(course); s.sections.push(sec);
  const imp = ["detail", "core", "supporting", "core", "core", "core", "core"];
  imp.forEach((importance, k) => {
    const c = makeConcept({ courseId: course.id, sectionId: sec.id, name: `K${k}`, order: k, importance });
    s.concepts.push(c);
    s.items.push(makeItem({ conceptId: c.id, ability: "apply", prompt: `apply ${k}`, answer: "a", points: ["a"] }));
    s.items.push(makeItem({ conceptId: c.id, ability: "recall", prompt: `recall ${k}`, answer: "a", accept: ["a"] }));
  });
  const tasks = pretestTasks(s, sec.id);
  assert.equal(tasks.length, 5);
  assert.deepEqual(tasks.map(t => index(s).concept[t.conceptId].name), ["K1", "K3", "K4", "K5", "K6"]);
  assert.ok(tasks.every(t => index(s).item[t.itemId].ability === "recall" && t.kind === "pretest"));
  assert.equal(sectionStarted(s, sec.id), false);
  const started = { ...s, concepts: s.concepts.map((c, k) => (k === 0 ? { ...c, srs: reviewSrs() } : c)) };
  assert.equal(sectionStarted(started, sec.id), true);
});

// ── Activation forecast ──────────────────────────────────────────────────────

test("activation forecast: a share of new concepts and what the course settles at", () => {
  const s = emptyState();
  s.settings.maxNewPerDay = 6;
  const course = makeCourse({ name: "C", status: "maintain" });
  const other = makeCourse({ name: "D", status: "active" });
  const sec = makeSection({ courseId: course.id, title: "S" });
  s.courses.push(course, other); s.sections.push(sec);
  for (let k = 0; k < 200; k++) {
    const c = makeConcept({ courseId: course.id, sectionId: sec.id, name: `K${k}`, order: k });
    s.concepts.push(c);
    s.items.push(makeItem({ conceptId: c.id, ability: "explain", prompt: `p${k}`, answer: "a", points: ["a"] }));
  }
  const f = activationForecast(s, course.id);
  assert.equal(f.left, 200);
  assert.equal(f.newPerDay, 3, "shared with the other Active course");
  assert.ok(f.perDay > f.newPerDay && f.perDay < 20, `settles at a few reviews plus the new ones (${f.perDay})`);
  s.courses[1] = { ...other, status: "paused" };
  assert.equal(activationForecast(s, course.id).newPerDay, 6);
  for (const c of s.concepts) c.srs = reviewSrs();
  assert.equal(activationForecast(s, course.id), null, "nothing left to start");
});

// ── Fresh versions ───────────────────────────────────────────────────────────

test("fresh versions: only apply and distinguish questions you've answered, never new, pretest or code ones", () => {
  let { s, iA, iB } = world();
  const ix0 = index(s);
  assert.equal(wantsFreshVersion(ix0, { kind: "review" }, iA), false, "not seen yet");
  s = reducer(s, { type: "attempt", itemId: iA.id, verdict: "correct", rating: RATING.GOOD, now: NOW });
  s = reducer(s, { type: "attempt", itemId: iB.id, verdict: "correct", rating: RATING.GOOD, now: NOW });
  const ix = index(s);
  assert.equal(wantsFreshVersion(ix, { kind: "review" }, ix.item[iA.id]), true);
  assert.equal(wantsFreshVersion(ix, { kind: "review" }, ix.item[iB.id]), false, "explain questions keep their wording");
  assert.equal(wantsFreshVersion(ix, { kind: "new" }, ix.item[iA.id]), false);
  assert.equal(wantsFreshVersion(ix, { kind: "pretest" }, ix.item[iA.id]), false);
  assert.equal(wantsFreshVersion(ix, { kind: "review" }, { ...ix.item[iA.id], tests: { lang: "python", code: "assert f()" } }), false);
});

// ── Code questions ───────────────────────────────────────────────────────────

test("code helpers: the code inside an answer, the language from a fence, whether tests exist", () => {
  assert.equal(codeOf("Here you go:\n```python\ndef f():\n    return 1\n```\nthanks"), "def f():\n    return 1");
  assert.equal(codeOf("int x = 1;"), "int x = 1;");
  assert.equal(guessLang("```c\nint main(){}\n```"), "c");
  assert.equal(guessLang("```py\nx=1\n```"), "python");
  assert.equal(guessLang("```js\nx\n```"), "javascript");
  assert.equal(guessLang("no fence"), null);
  assert.equal(hasTests({ tests: { lang: "python", code: "assert True" } }), true);
  assert.equal(hasTests({ tests: { lang: "rust", code: "x" } }), false);
  assert.equal(hasTests({ tests: { lang: "python", code: "  " } }), false);
  assert.equal(hasTests({}), false);
});

test("a credited prerequisite that was due today is no longer due, only an optional early review", () => {
  const { s, B, iA } = world({ basic: reviewSrs({ stability: 10, daysAgo: 10 }) });
  assert.ok(buildPlan(s, { now: NOW }).tasks.some(t => t.conceptId === B.id && !t.early), "due today before");
  const next = reducer(s, { type: "attempt", itemId: iA.id, verdict: "correct", rating: RATING.GOOD, now: NOW });
  const b = buildPlan(next, { now: NOW + 60e3 }).tasks.find(t => t.conceptId === B.id);
  assert.ok(!b || b.early, "at most pulled forward to fill the day");
  assert.ok(next.concepts.find(c => c.id === B.id).srs.due > NOW + DAY);
});
