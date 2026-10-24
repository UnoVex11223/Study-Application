// Daily planner: the same number of questions every day (Settings →
// Questions per day, 20 by default), shared out between your courses.
//
// How a day is built
//  1. How many are left: your number for the day (plus any extra you asked
//     for after finishing), less the questions you've already answered in
//     today's sessions. A missed question asked again in the same session
//     doesn't count twice; practice and teach back don't count at all.
//  2. What can't wait. Memory is scheduled per concept; a due concept is asked
//     through one of its questions, taking turns (pickItem), so extra questions
//     add variety without adding reviews. Same-day relearning and every review
//     that's starting to slip (recall chance 5 points under your target or
//     lower) come first, most urgent first: how close it is to being
//     forgotten, weighted by importance (core > supporting > detail) and by
//     how many other concepts build on it.
//  3. An even mix (Settings → Daily mix: Even, the default). The rest of the
//     day is dealt out one question at a time to whichever course has had the
//     fewest so far, so every course you're studying shows up each day, not
//     just the one with the most material. A course plays its turn with its
//     next due review, or, once all of its due reviews are in, with a new
//     concept (Active courses only, up to the daily cap). A review that is due
//     but still well remembered can wait a day or two for the mix: FSRS's
//     curve is flat near the due date, so a short wait costs very little, and
//     once it starts to slip it's in step 2. With "By what's due" the rest of
//     the day goes to the most urgent reviews anywhere, then new concepts in
//     turn, as before.
//     New concepts come from the "knowledge frontier": concepts whose
//     prerequisites you've already started. None if a slipping review didn't
//     fit today, fewer if the coming week (counting what waited today) is
//     already busy, so new material can't snowball.
//  4. Anything still left is filled with the reviews coming up soonest,
//     courses taking turns again, so the day has its full number and the days
//     ahead get lighter. Ideas that are easy to confuse with something already
//     in today's session go first.
//  5. Order: courses take turns, new concepts are spaced between reviews, and
//     two ideas marked "easily confused" are asked back to back, which is when
//     contrasting them helps most (Brunmair & Richter, 2019).

import { retrievability } from "./fsrs.js";
import { index, IMPORTANCE } from "./model.js";
import { dayKey, dayEndTs, DAY_MS } from "./time.js";

const PROVISIONAL = 0.6;           // prereq edges below this confidence don't gate
const EARLY_DAYS = 14;             // reviews pulled forward to fill a day come from the next two weeks
const SLIP_MARGIN = 0.05;          // below target retention by this much, a review can't wait for the mix
export const DEFAULT_PER_DAY = 20;
export const MIX = {
  even: { label: "Even", blurb: "Every course gets its turn each day" },
  due: { label: "By what's due", blurb: "The most urgent reviews first, wherever they are" },
};

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

/** For each concept, the concepts it's marked "easily confused" with. */
function contrastPartners(ix) {
  const out = {};
  for (const list of Object.values(ix.relatedOf)) {
    for (const e of list) {
      if (e.type !== "contrast" || (e.confidence ?? 1) < PROVISIONAL) continue;
      (out[e.from] ||= new Set()).add(e.to);
      (out[e.to] ||= new Set()).add(e.from);
    }
  }
  return out;
}

/**
 * Deal `room` slots to courses one at a time, always to the course with the
 * fewest so far (ties: the order given). `next(courseId)` returns the course's
 * next task, or null once it has nothing more to give.
 */
function dealEvenly(courseIds, counts, room, next) {
  const out = [];
  const live = new Set(courseIds);
  while (room > 0 && live.size) {
    let pick = null;
    for (const id of courseIds) if (live.has(id) && (pick == null || (counts[id] || 0) < (counts[pick] || 0))) pick = id;
    const task = next(pick);
    if (!task) { live.delete(pick); continue; }
    out.push(task);
    counts[pick] = (counts[pick] || 0) + 1;
    room--;
  }
  return out;
}

/**
 * Build today's session.
 * @returns {{tasks, perDay, goal, done, deferred, slipping, newCount, early, short, throttle, byCourse, mix}}
 *   goal: questions for today (perDay plus any extra); done: answered so far;
 *   deferred: due reviews that didn't fit (slipping: how many of them are
 *   starting to slip; the rest are still well remembered and wait for the mix);
 *   early: reviews pulled forward to fill the day; short: there wasn't enough
 *   material to fill it.
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
  const mix = MIX[s.mix] ? s.mix : "even";
  const slipAt = (s.retention ?? 0.9) - SLIP_MARGIN;

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
    // Relearning and slipping reviews can't wait; the rest can, for a day or two, to keep the mix.
    const urgent = mix === "due" || x.learning || x.r < slipAt;
    return { ...x, priority, urgent };
  }).sort((a, b) => b.priority - a.priority);

  const asTask = (x) => ({ itemId: x.item.id, conceptId: x.concept.id, courseId: x.concept.courseId, kind: x.learning ? "learning" : "review" });
  const urgent = scored.filter(x => x.urgent);
  const reviews = urgent.slice(0, left).map(asTask);
  const urgentDeferred = urgent.length - reviews.length;
  const inPlan = new Set(reviews.map(t => t.conceptId));
  const counts = {};
  for (const t of reviews) counts[t.courseId] = (counts[t.courseId] || 0) + 1;

  // Due reviews that can wait for the mix, per course, most urgent first.
  const softByCourse = {};
  for (const x of scored) if (!x.urgent) (softByCourse[x.concept.courseId] ||= []).push(x);
  const softTotal = scored.length - urgent.length;

  // ── 2. New material: how much can we afford? ──────────────────────────────
  let newCap = Math.max(0, s.maxNewPerDay - introducedToday);
  let throttle = null;
  if (urgentDeferred > 0) { newCap = 0; throttle = "backlog"; }
  else {
    const { count } = forecastLoad(state, { now, days: 8 });
    // Reviews that wait today for the mix land in the coming week too.
    const spare = Math.max(0, softTotal - Math.max(0, left - reviews.length));
    const weekAvg = (count.slice(1).reduce((a, b) => a + b, 0) + spare) / 7;
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

  const introducedTodayByCourse = {};
  for (const [cid, d] of Object.entries(firstDay)) {
    if (d !== today) continue;
    const c = ix.concept[cid];
    if (c) introducedTodayByCourse[c.courseId] = (introducedTodayByCourse[c.courseId] || 0) + 1;
  }
  const cursors = {};
  let newBudget = newCap;
  /** The course's next new concept, if the day can still take one. */
  const nextNew = (courseId) => {
    if (newBudget <= 0) return null;
    const list = frontierByCourse[courseId];
    if (!list) return null;
    let k = cursors[courseId] || 0;
    while (k < list.length && inPlan.has(list[k].concept.id)) k++;
    if (k >= list.length) { cursors[courseId] = k; return null; }
    const f = list[k];
    cursors[courseId] = k + 1;
    inPlan.add(f.concept.id);
    newBudget--;
    return { itemId: f.item.id, conceptId: f.concept.id, courseId, kind: "new" };
  };
  const softCursor = {};
  const nextSoft = (courseId) => {
    const list = softByCourse[courseId];
    const k = softCursor[courseId] || 0;
    if (!list || k >= list.length) return null;
    softCursor[courseId] = k + 1;
    inPlan.add(list[k].concept.id);
    return asTask(list[k]);
  };

  // Courses in a stable order: the ones that have had the fewest new concepts today first.
  const courseOrder = state.courses.filter(c => c.status !== "paused").map(c => c.id)
    .sort((a, b) => (introducedTodayByCourse[a] || 0) - (introducedTodayByCourse[b] || 0));

  let room = left - reviews.length;
  const softPicks = [], newPicks = [];
  if (mix === "even") {
    // ── 3. An even mix: deal the rest of the day course by course ───────────
    for (const t of dealEvenly(courseOrder, counts, room, (id) => nextSoft(id) || nextNew(id))) {
      (t.kind === "new" ? newPicks : softPicks).push(t);
    }
  } else {
    // ── 3. By what's due: every due review first, then new concepts in turn ──
    // (all due reviews are already in `reviews`; new concepts round-robin.)
    let progress = true;
    while (progress && room - newPicks.length > 0) {
      progress = false;
      for (const id of courseOrder) {
        if (room - newPicks.length <= 0) break;
        const t = nextNew(id);
        if (t) { newPicks.push(t); progress = true; }
      }
    }
  }
  room -= softPicks.length + newPicks.length;
  const deferred = urgentDeferred + (softTotal - softPicks.length);

  // ── 4. Fill the rest of the day with the reviews coming up soonest ────────
  const early = [];
  if (room > 0) {
    const horizon = end + EARLY_DAYS * DAY_MS;
    const upcoming = state.concepts
      .filter(c => c.srs?.state === "review" && c.srs.due > end && c.srs.due <= horizon
        && isEligible(ix, c) && !inPlan.has(c.id) && !askedToday.has(c.id))
      .sort((a, b) => a.srs.due - b.srs.due);
    const take = (c) => {
      const item = pickItem(ix, c, { exclude });
      if (!item) return null;
      inPlan.add(c.id);
      return { itemId: item.id, conceptId: c.id, courseId: c.courseId, kind: "review", early: true };
    };
    // Ideas easy to confuse with one already in the session come first, so the two can be asked together.
    const partners = contrastPartners(ix);
    for (const c of upcoming) {
      if (room <= 0) break;
      if (inPlan.has(c.id) || ![...(partners[c.id] || [])].some(p => inPlan.has(p))) continue;
      const t = take(c);
      if (t) { early.push(t); counts[c.courseId] = (counts[c.courseId] || 0) + 1; room--; }
    }
    if (mix === "even") {
      // A course with nothing coming up in the next two weeks can still take
      // its turn with what it's been longest since you saw: once everything
      // due is in, the day is filled either way, so this costs nothing.
      const later = state.concepts
        .filter(c => c.srs?.state === "review" && c.srs.due > horizon
          && isEligible(ix, c) && !inPlan.has(c.id) && !askedToday.has(c.id))
        .map(c => ({ c, r: retrievability(c.srs, now) ?? 1 }))
        .sort((a, b) => a.r - b.r)
        .map(x => x.c);
      const byCourse = {};
      for (const c of [...upcoming, ...later]) (byCourse[c.courseId] ||= []).push(c);
      const pos = {};
      early.push(...dealEvenly(courseOrder, counts, room, (id) => {
        const list = byCourse[id] || [];
        for (let k = pos[id] || 0; k < list.length; k++) {
          pos[id] = k + 1;
          if (inPlan.has(list[k].id)) continue;
          const t = take(list[k]);
          if (t) return t;
        }
        return null;
      }));
    } else {
      for (const c of upcoming) {
        if (room <= 0) break;
        if (inPlan.has(c.id)) continue;
        const t = take(c);
        if (t) { early.push(t); room--; }
      }
    }
  }

  // ── 5. Order ───────────────────────────────────────────────────────────────
  const tasks = interleave([...reviews, ...softPicks, ...early], newPicks, contrastPartners(ix));
  const byCourse = {};
  for (const t of tasks) {
    const b = (byCourse[t.courseId] ||= { courseId: t.courseId, count: 0, fresh: 0 });
    b.count++;
    if (t.kind === "new") b.fresh++;
  }
  if (!throttle && deferred > 0 && newPicks.length === 0) throttle = "backlog";

  return {
    today, tasks, perDay, goal, done, deferred, slipping: urgentDeferred, throttle, mix,
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

/**
 * Round-robin by course; after every two reviews, slot in one new task. Then
 * two concepts marked "easily confused" (`partners`: conceptId → Set) are put
 * back to back, so you contrast them while both are fresh.
 */
export function interleave(reviews, fresh, partners = null) {
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
  if (!partners) return out;
  const paired = new Set();
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (paired.has(t.conceptId)) continue;
    const mine = partners[t.conceptId];
    if (!mine) continue;
    const j = out.findIndex((u, k) => k > i && !paired.has(u.conceptId) && mine.has(u.conceptId));
    if (j < 0) continue;
    paired.add(t.conceptId);
    paired.add(out[j].conceptId);
    if (j !== i + 1) out.splice(i + 1, 0, ...out.splice(j, 1));
    i++;
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
