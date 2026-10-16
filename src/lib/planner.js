// Daily planner: the same number of questions every day (Settings →
// Questions per day, 20 by default), and how much of it can be new material.
//
// How a day is built
//  1. How many are left: your number for the day (plus any extra you asked
//     for after finishing), less the questions you've already answered in
//     today's sessions. A missed question asked again in the same session
//     doesn't count twice; practice and teach back don't count at all.
//  2. Reviews first. Memory is scheduled per concept; a due concept is asked
//     through one of its questions, taking turns (pickItem), so extra questions
//     add variety without adding reviews. Everything due today is ranked:
//     same-day relearning first, then by how close it is to being forgotten,
//     weighted by importance (core > supporting > detail) and by how many
//     other concepts build on it. Whatever doesn't fit waits for tomorrow; its
//     urgency keeps rising, so nothing is starved forever.
//  3. New material fills what's left, up to the daily cap. New concepts come
//     from the "knowledge frontier": concepts whose prerequisites you've
//     already started. None if reviews were left over today, fewer if the
//     coming week is already busy, so new material can't snowball.
//  4. Anything still left is filled with the reviews coming up soonest, so the
//     day has its full number and the days ahead get lighter.
//  5. Interleave across courses so similar items aren't blocked together.

import { retrievability } from "./fsrs.js";
import { index, IMPORTANCE } from "./model.js";
import { dayKey, dayEndTs, DAY_MS } from "./time.js";

const PROVISIONAL = 0.6;           // prereq edges below this confidence don't gate
const EARLY_DAYS = 14;             // reviews pulled forward to fill a day come from the next two weeks
export const DEFAULT_PER_DAY = 20;

/** Questions in a day's session (the setting, or one worked out from the old time budget). */
export const questionsPerDay = (settings) => Math.max(1, Math.round(settings?.dailyQuestions || DEFAULT_PER_DAY));

/** Questions answered in today's sessions: practice, teach back and a missed question asked again don't count. */
export function answeredOn(state, day) {
  let n = 0;
  for (const a of state.attempts) if (a.day === day && a.mode === "session" && !a.requeue) n++;
  return n;
}

/** Reviews already scheduled for each of the next `days` days. */
export function forecastLoad(state, { now = Date.now(), days = 14 } = {}) {
  const ix = index(state);
  const { rolloverHour } = state.settings;
  const start = dayEndTs(now, rolloverHour) - DAY_MS;
  const count = new Array(days).fill(0);
  for (const c of state.concepts) {
    const srs = c.srs;
    if (!srs || srs.state === "new" || srs.due == null || !isEligible(ix, c)) continue;
    if (!pickItem(ix, c)) continue;
    let d = Math.floor((srs.due - start) / DAY_MS);
    if (d < 0) d = 0;
    if (d >= days) continue;
    count[d]++;
  }
  return { count };
}

/**
 * Which of a concept's questions to ask. A new concept starts with its most
 * basic question; during same-day relearning, the question you just missed
 * comes back; otherwise the question asked longest ago (never-asked first),
 * so every variant gets its turn.
 */
export function pickItem(ix, concept, { exclude } = {}) {
  const items = (ix.itemsByConcept[concept.id] || []).filter(i => !i.flag && !exclude?.has(i.id));
  if (!items.length) return null;
  const srs = concept.srs;
  if (!srs || srs.state === "new") return items[0];
  if (srs.state === "learning" || srs.state === "relearning") {
    const attempts = ix.attemptsByConcept[concept.id] || [];
    for (let k = attempts.length - 1; k >= 0; k--) {
      if (attempts[k].rating == null) continue;
      const last = items.find(i => i.id === attempts[k].itemId);
      if (last) return last;
      break;
    }
  }
  let best = items[0];
  for (const it of items) if ((ix.itemStats[it.id]?.lastSeen ?? 0) < (ix.itemStats[best.id]?.lastSeen ?? 0)) best = it;
  return best;
}

function isEligible(ix, concept) {
  if (!concept || concept.suspended) return false;
  const course = ix.course[concept.courseId];
  return Boolean(course && course.status !== "paused");
}

/**
 * Build today's session.
 * @returns {{tasks, perDay, goal, done, deferred, newCount, early, short, throttle, byCourse}}
 *   goal: questions for today (perDay plus any extra); done: answered so far;
 *   deferred: due reviews that didn't fit; early: reviews pulled forward to fill
 *   the day; short: there wasn't enough material to fill it.
 */
export function buildPlan(state, { now = Date.now(), exclude = new Set() } = {}) {
  const ix = index(state);
  const s = state.settings;
  const today = dayKey(now, s.rolloverHour);
  const end = dayEndTs(now, s.rolloverHour);
  const perDay = questionsPerDay(s);
  const goal = perDay + (state.days?.[today]?.extra || 0);
  const done = answeredOn(state, today);
  const left = Math.max(0, goal - done);

  // Which concepts are introduced at all, which were started today, which were asked today.
  const firstDay = {};
  const askedToday = new Set();
  for (const a of state.attempts) {
    if (!firstDay[a.conceptId] || a.day < firstDay[a.conceptId]) firstDay[a.conceptId] = a.day;
    if (a.day === today) askedToday.add(a.conceptId);
  }
  const introduced = new Set(Object.keys(firstDay));
  for (const c of state.concepts) if (c.srs && c.srs.state !== "new") introduced.add(c.id);
  const introducedToday = Object.values(firstDay).filter(d => d === today).length;

  // ── 1. Due reviews (and same-day relearning), one question per concept ─────
  const dueNow = [];
  for (const c of state.concepts) {
    const srs = c.srs;
    if (!srs || srs.state === "new" || srs.due == null || srs.due > end) continue;
    if (!isEligible(ix, c)) continue;
    const item = pickItem(ix, c, { exclude });
    if (!item) continue;
    const learning = srs.state === "learning" || srs.state === "relearning";
    dueNow.push({ item, concept: c, learning, r: retrievability(srs, now) ?? 0 });
  }

  const scored = dueNow.map(x => {
    const dependents = (ix.dependentsOf[x.concept.id] || []).length;
    const course = ix.course[x.concept.courseId];
    const overdueDays = Math.max(0, (now - x.concept.srs.due) / DAY_MS);
    const priority = x.learning ? 1000 + (1 - x.r)
      : (1 - x.r) * (IMPORTANCE[x.concept.importance]?.weight ?? 0.75)
        * (1 + 0.1 * Math.min(dependents, 5))
        * (course.status === "maintain" ? 0.9 : 1)
        + 0.02 * Math.min(overdueDays, 30);
    return { ...x, priority };
  }).sort((a, b) => b.priority - a.priority);

  const reviews = scored.slice(0, left).map(x => ({ itemId: x.item.id, conceptId: x.concept.id, courseId: x.concept.courseId, kind: x.learning ? "learning" : "review" }));
  const deferred = scored.length - reviews.length;
  const inPlan = new Set(reviews.map(t => t.conceptId));

  // ── 2. New material: how much can we afford? ──────────────────────────────
  let newCap = Math.max(0, s.maxNewPerDay - introducedToday);
  let throttle = null;
  if (deferred > 0) { newCap = 0; throttle = "backlog"; }
  else {
    const { count } = forecastLoad(state, { now, days: 8 });
    const weekAvg = count.slice(1).reduce((a, b) => a + b, 0) / 7;
    const ratio = weekAvg / perDay;
    if (ratio > 0.9) { newCap = 0; throttle = "forecast"; }
    else if (ratio > 0.7) { newCap = Math.ceil(newCap / 2); throttle = newCap ? "forecast-half" : "forecast"; }
  }

  // Frontier: new concepts whose (confident) prerequisites are already started.
  const frontierByCourse = {};
  for (const course of state.courses) {
    if (course.status !== "active") continue;
    const list = [];
    for (const sec of ix.sectionsByCourse[course.id] || []) {
      for (const c of ix.conceptsBySection[sec.id] || []) {
        // Chapters you haven't read yet (locked) don't introduce anything.
        if (c.suspended || introduced.has(c.id) || ix.lockedConcepts.has(c.id)) continue;
        const item = pickItem(ix, c, { exclude });
        if (!item) continue;
        const ready = (ix.prereqsOf[c.id] || []).every(e => {
          if ((e.confidence ?? 1) < PROVISIONAL) return true;
          const p = ix.concept[e.from];
          // A prerequisite in a chapter you haven't unlocked doesn't hold you back:
          // reading out of order is your call.
          if (!p || p.suspended || ix.lockedConcepts.has(p.id) || !(ix.itemsByConcept[p.id] || []).length) return true;
          if (!isEligible(ix, p)) return true;
          return introduced.has(p.id);
        });
        if (ready) list.push({ concept: c, item, sectionOrder: sec.order });
      }
    }
    // Curriculum order, but core ideas of a section before its details.
    list.sort((a, b) => (a.sectionOrder - b.sectionOrder)
      || (IMPORTANCE[a.concept.importance].rank - IMPORTANCE[b.concept.importance].rank)
      || (a.concept.order - b.concept.order));
    if (list.length) frontierByCourse[course.id] = list;
  }

  // Round-robin across courses so several subjects advance in parallel.
  const introducedTodayByCourse = {};
  for (const [cid, d] of Object.entries(firstDay)) {
    if (d !== today) continue;
    const c = ix.concept[cid];
    if (c) introducedTodayByCourse[c.courseId] = (introducedTodayByCourse[c.courseId] || 0) + 1;
  }
  const courseOrder = Object.keys(frontierByCourse)
    .sort((a, b) => (introducedTodayByCourse[a] || 0) - (introducedTodayByCourse[b] || 0));
  const newPicks = [];
  const cursors = Object.fromEntries(courseOrder.map(id => [id, 0]));
  let room = Math.min(newCap, left - reviews.length);
  let progress = true;
  while (progress && room > 0) {
    progress = false;
    for (const courseId of courseOrder) {
      if (room <= 0) break;
      const list = frontierByCourse[courseId];
      while (cursors[courseId] < list.length && inPlan.has(list[cursors[courseId]].concept.id)) cursors[courseId]++;
      if (cursors[courseId] >= list.length) continue;
      const f = list[cursors[courseId]++];
      inPlan.add(f.concept.id);
      newPicks.push({ itemId: f.item.id, conceptId: f.concept.id, courseId, kind: "new" });
      room--; progress = true;
    }
  }

  // ── 3. Fill the rest of the day with the reviews coming up soonest ────────
  const early = [];
  let fill = left - reviews.length - newPicks.length;
  if (fill > 0) {
    const horizon = end + EARLY_DAYS * DAY_MS;
    const upcoming = state.concepts
      .filter(c => c.srs?.state === "review" && c.srs.due > end && c.srs.due <= horizon
        && isEligible(ix, c) && !inPlan.has(c.id) && !askedToday.has(c.id))
      .sort((a, b) => a.srs.due - b.srs.due);
    for (const c of upcoming) {
      if (fill <= 0) break;
      const item = pickItem(ix, c, { exclude });
      if (!item) continue;
      early.push({ itemId: item.id, conceptId: c.id, courseId: c.courseId, kind: "review", early: true });
      inPlan.add(c.id);
      fill--;
    }
  }

  // ── 4. Interleave ──────────────────────────────────────────────────────────
  const tasks = interleave([...reviews, ...early], newPicks);
  const byCourse = {};
  for (const t of tasks) {
    const b = (byCourse[t.courseId] ||= { courseId: t.courseId, count: 0, fresh: 0 });
    b.count++;
    if (t.kind === "new") b.fresh++;
  }

  return {
    today, tasks, perDay, goal, done, deferred, throttle,
    newCount: newPicks.length, early: early.length, short: tasks.length < left,
    byCourse: Object.values(byCourse).sort((a, b) => b.count - a.count),
  };
}

/**
 * Extra practice on a chosen scope (a concept, a section, or a whole course).
 * One question per concept, weakest memory first; for a single concept, all of its questions.
 */
export function practiceTasks(state, { conceptId, sectionId, courseId, limit = 15, now = Date.now() }) {
  const ix = index(state);
  const task = (it, c) => ({ itemId: it.id, conceptId: c.id, courseId: c.courseId, kind: !c.srs || c.srs.state === "new" ? "new" : "practice" });
  if (conceptId) {
    const c = ix.concept[conceptId];
    return c ? (ix.itemsByConcept[conceptId] || []).filter(it => !it.flag).map(it => task(it, c)) : [];
  }
  const concepts = sectionId ? (ix.conceptsBySection[sectionId] || []) : (ix.conceptsByCourse[courseId] || []);
  const picks = [];
  for (const c of concepts) {
    if (c.suspended || ix.lockedConcepts.has(c.id)) continue;
    const pick = pickItem(ix, c);
    if (!pick) continue;
    const r = retrievability(c.srs, now) ?? 1.5; // not started yet: after the ones you're forgetting
    picks.push({ t: task(pick, c), r });
  }
  return picks.sort((a, b) => a.r - b.r).slice(0, limit).map(p => p.t);
}

/** Round-robin by course; after every two reviews, slot in one new task. */
export function interleave(reviews, fresh) {
  const rr = (list) => {
    const groups = {};
    for (const t of list) (groups[t.courseId] ||= []).push(t);
    const keys = Object.keys(groups);
    const out = [];
    let added = true;
    for (let i = 0; added; i++) {
      added = false;
      for (const k of keys) if (groups[k][i]) { out.push(groups[k][i]); added = true; }
    }
    return out;
  };
  const r = rr(reviews), f = rr(fresh), out = [];
  let ri = 0, fi = 0;
  while (ri < r.length || fi < f.length) {
    for (let n = 0; n < 2 && ri < r.length; n++) out.push(r[ri++]);
    if (fi < f.length) out.push(f[fi++]);
  }
  return out;
}

/** Due-count per study day, used by FSRS load balancing. */
export function makeLoadAt(state) {
  const { rolloverHour } = state.settings;
  const counts = {};
  for (const c of state.concepts) {
    const d = c.srs?.due;
    if (d == null || c.srs.state === "new") continue;
    const k = dayKey(d, rolloverHour);
    counts[k] = (counts[k] || 0) + 1;
  }
  return (ts) => counts[dayKey(ts, rolloverHour)] || 0;
}
