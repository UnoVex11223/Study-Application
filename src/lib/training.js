// Training extras that sit on top of the scheduler. Pure functions, unit-tested.
//
//  - Implicit review: a correct answer on a concept gives its direct
//    prerequisites partial review credit (fsrs.implicitReview), so practising
//    advanced ideas also keeps the basics underneath them warm.
//  - Pace: how long you usually take to produce a correct answer of each kind,
//    so a right-but-slow answer can be told apart from a fluent one.
//  - Why you missed it: four reasons, each with its own fix.
//  - Pretests: questions on material you haven't started, asked before you
//    study it (they're never scheduled or counted).
//  - Activation forecast: how much of your day a course would take if Active.
//  - Fresh versions: which questions get a new example instead of the stored one.

import { index, IMPORTANCE, ABILITIES } from "./model.js";
import { implicitReview, rate, newSrs, RATING } from "./fsrs.js";
import { pickItem } from "./planner.js";

const DAY_MS = 864e5;
const PROVISIONAL = 0.6; // prerequisite links below this confidence don't pass credit on

// ── Implicit review ────────────────────────────────────────────────────────

/**
 * New srs for each direct prerequisite of `conceptId` that a correct answer on
 * it should partly review. Returns { [prereqId]: srs } (only the ones that change).
 */
export function implicitCredit(state, conceptId, now = Date.now()) {
  const ix = index(state);
  const out = {};
  for (const e of ix.prereqsOf[conceptId] || []) {
    const conf = e.confidence ?? 1;
    if (conf < PROVISIONAL) continue;
    const p = ix.concept[e.from];
    if (!p || p.suspended || ix.lockedConcepts.has(p.id)) continue;
    const next = implicitReview(p.srs, now, { weight: 0.5 * Math.min(1, conf), retention: state.settings.retention });
    if (next !== p.srs) out[p.id] = next;
  }
  return out;
}

// ── Pace ───────────────────────────────────────────────────────────────────
const PACE_SAMPLES = 8;     // answers of a kind before your own pace is used
const PACE_WINDOW = 200;    // the most recent answers of that kind

/** Your typical time (ms) to a correct, unaided answer of this kind, or null if there isn't enough history yet. */
export function typicalPace(attempts, ability) {
  const times = [];
  for (let k = attempts.length - 1; k >= 0 && times.length < PACE_WINDOW; k--) {
    const a = attempts[k];
    if (a.ability === ability && a.verdict === "correct" && !a.aided && a.answerMs > 0) times.push(a.answerMs);
  }
  if (times.length < PACE_SAMPLES) return null;
  times.sort((x, y) => x - y);
  return times[Math.floor(times.length / 2)];
}

/**
 * Was this correct answer slow? Twice your usual time for that kind of
 * question (and at least 30 seconds over it). Without enough history, a
 * generous allowance based on the question type.
 */
export function isSlow(answerMs, ability, pace = null) {
  if (!(answerMs > 0)) return false;
  if (pace) return answerMs > Math.max(2 * pace, pace + 30e3);
  return answerMs > (ABILITIES[ability]?.estSec ?? 60) * 3000;
}

// ── Why you missed it ──────────────────────────────────────────────────────
export const MISS_REASONS = {
  forgot:        { label: "Forgot",            blurb: "I knew it once" },
  misconception: { label: "Mixed it up",       blurb: "I believed something wrong" },
  slip:          { label: "Slip",              blurb: "I knew it, careless mistake" },
  unlearned:     { label: "Never really learned it", blurb: "This needs relearning, not review" },
};

// ── Pretests ───────────────────────────────────────────────────────────────

/** Has anything in this section been started? */
export function sectionStarted(state, sectionId) {
  const ix = index(state);
  return (ix.conceptsBySection[sectionId] || []).some(c => (c.srs && c.srs.state !== "new") || (ix.attemptsByConcept[c.id] || []).length);
}

/**
 * A short pretest on a section you haven't started: its core ideas first, one
 * basic question each. Trying to answer before you study makes the material
 * stick better afterwards, even when every attempt is wrong.
 */
export function pretestTasks(state, sectionId, limit = 5) {
  const ix = index(state);
  return (ix.conceptsBySection[sectionId] || [])
    .filter(c => !c.suspended)
    .map(c => ({ c, item: pickItem(ix, { ...c, srs: newSrs() }) }))
    .filter(x => x.item)
    .sort((a, b) => (IMPORTANCE[a.c.importance]?.rank ?? 1) - (IMPORTANCE[b.c.importance]?.rank ?? 1) || a.c.order - b.c.order)
    .slice(0, limit)
    .map(({ c, item }) => ({ itemId: item.id, conceptId: c.id, courseId: c.courseId, kind: "pretest" }));
}

// ── Activation forecast ────────────────────────────────────────────────────

/** Days on which one new concept is asked over `days`, if you get it right each time (same-day steps count). */
function questionDays(retention, days) {
  const hits = new Array(days).fill(0);
  let srs = newSrs(), t = 0;
  const fixed = { retention, random: () => 0.5 };
  for (let guard = 0; guard < 40; guard++) {
    const d = Math.floor(t / DAY_MS);
    if (d >= days) break;
    hits[d]++;
    srs = rate(srs, RATING.GOOD, t, fixed);
    t = srs.due;
  }
  return hits;
}

/**
 * Roughly how many of your daily questions a course would take within a
 * month at its share of new concepts, if you get most of them right.
 * Returns { left, newPerDay, perDay, days } or null when there's nothing left to start.
 */
export function activationForecast(state, courseId, { days = 30 } = {}) {
  const ix = index(state);
  const course = ix.course[courseId];
  if (!course) return null;
  const left = (ix.conceptsByCourse[courseId] || []).filter(c =>
    !c.suspended && !ix.lockedConcepts.has(c.id) && (!c.srs || c.srs.state === "new")
    && !(ix.attemptsByConcept[c.id] || []).length && (ix.itemsByConcept[c.id] || []).some(i => !i.flag)).length;
  if (!left) return null;
  const active = state.courses.filter(c => c.status === "active" && c.id !== courseId).length + 1;
  const newPerDay = Math.max(0.5, (state.settings.maxNewPerDay ?? 6) / active);
  const pattern = questionDays(state.settings.retention ?? 0.9, days);
  const load = new Array(days).fill(0);
  let remaining = left;
  for (let d = 0; d < days && remaining > 0; d++) {
    const n = Math.min(newPerDay, remaining);
    remaining -= n;
    for (let k = 0; d + k < days; k++) load[d + k] += n * pattern[k];
  }
  // The last week of the month: what the course settles at, not its first days.
  const tail = load.slice(-7);
  const perDay = tail.reduce((a, b) => a + b, 0) / tail.length;
  return { left, newPerDay, perDay, days };
}

// ── Fresh versions ─────────────────────────────────────────────────────────
export const FRESH_ABILITIES = new Set(["apply", "distinguish"]);

/** Should this question come back as a fresh version? Only ones you've answered before, and never pretests or code questions. */
export function wantsFreshVersion(ix, task, item) {
  if (!item || !FRESH_ABILITIES.has(item.ability) || item.tests?.code) return false;
  if (task.kind === "new" || task.kind === "pretest" || task.kind === "requeue") return false;
  return (ix.itemStats[item.id]?.seen ?? 0) >= 1;
}
