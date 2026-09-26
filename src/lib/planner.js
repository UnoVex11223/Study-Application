// Daily planner: turns everything that's due into a session that fits your
// time budget, and decides how much new material you can afford today.
//
// How a day is built
//  1. Reviews first. Everything due today is ranked by how close it is to being
//     forgotten, weighted by importance (core > supporting > detail) and by how
//     many other concepts build on it. One task per concept per day ("sibling
//     burying"), so the same idea never shows up twice.
//  2. Fill the time budget in that order. Whatever doesn't fit waits for a
//     later day; its urgency keeps rising, so nothing is starved forever.
//  3. New material only if there's room. New concepts come from the
//     "knowledge frontier": concepts whose prerequisites you've already
//     started. Intake is throttled if reviews were deferred today or if the
//     next week is already heavy, so today's new material can't snowball into
//     an unmanageable backlog.
//  4. Interleave across courses so similar items aren't blocked together.

import { retrievability } from "./fsrs.js";
import { index, ABILITIES, IMPORTANCE } from "./model.js";
import { dayKey, dayEndTs, DAY_MS } from "./time.js";

const MAX_ATTEMPT_SEC = 300;       // ignore time beyond 5 min (walked away)
const NEW_CONCEPT_FACTOR = 2.2;    // a new concept is seen ~2–3 times on day one
const PROVISIONAL = 0.6;           // prereq edges below this confidence don't gate
const LEARNING_ALWAYS_MAX = 12;    // short-term relearning steps always fit

/** Median seconds per task, by ability, from your own recent history. */
export function abilityTimes(state) {
  const samples = {};
  for (let i = state.attempts.length - 1, n = 0; i >= 0 && n < 400; i--) {
    const a = state.attempts[i];
    if (!a.ms || a.mode === "teachback") continue;
    (samples[a.ability] ||= []).push(Math.min(a.ms / 1000, MAX_ATTEMPT_SEC));
    n++;
  }
  const out = {};
  for (const [k, meta] of Object.entries(ABILITIES)) {
    const s = (samples[k] || []).sort((a, b) => a - b);
    const median = s.length >= 5 ? s[Math.floor(s.length / 2)] : null;
    // Blend toward the default until there's enough history.
    out[k] = median == null ? meta.estSec : Math.round(Math.min(240, Math.max(10, (median * s.length + meta.estSec * 5) / (s.length + 5))));
  }
  return out;
}

export function studiedSecOn(state, day) {
  let sec = 0;
  for (const a of state.attempts) if (a.day === day && a.ms) sec += Math.min(a.ms / 1000, MAX_ATTEMPT_SEC);
  return Math.round(sec);
}

/** Seconds of reviews already scheduled for each of the next `days` days. */
export function forecastLoad(state, { now = Date.now(), days = 14 } = {}) {
  const ix = index(state);
  const est = abilityTimes(state);
  const { rolloverHour } = state.settings;
  const start = dayEndTs(now, rolloverHour) - DAY_MS;
  const sec = new Array(days).fill(0), count = new Array(days).fill(0);
  const seen = new Array(days).fill(null).map(() => new Set());
  for (const it of state.items) {
    const srs = it.srs;
    if (!srs || srs.state === "new" || srs.due == null) continue;
    const c = ix.concept[it.conceptId];
    const course = c && ix.course[c.courseId];
    if (!c || c.suspended || !course || course.status === "paused") continue;
    let d = Math.floor((srs.due - start) / DAY_MS);
    if (d < 0) d = 0;
    if (d >= days || seen[d].has(it.conceptId)) continue;
    seen[d].add(it.conceptId);
    sec[d] += est[it.ability] ?? 60;
    count[d]++;
  }
  return { sec, count };
}

function isEligible(ix, concept) {
  if (!concept || concept.suspended) return false;
  const course = ix.course[concept.courseId];
  return Boolean(course && course.status !== "paused");
}

/**
 * Build today's session.
 * @returns {{tasks, estSec, budgetSec, spentSec, deferred, newCount, deepenCount, newCap,
 *            throttle, laterToday, byCourse, dueConcepts}}
 */
export function buildPlan(state, { now = Date.now(), exclude = new Set() } = {}) {
  const ix = index(state);
  const s = state.settings;
  const today = dayKey(now, s.rolloverHour);
  const end = dayEndTs(now, s.rolloverHour);
  const est = abilityTimes(state);
  const spentSec = studiedSecOn(state, today);
  const extraSec = state.days?.[today]?.extraSec || 0;
  const budgetSec = Math.max(0, s.dailyMinutes * 60 + extraSec - spentSec);

  // Who started today? Which concepts are introduced at all?
  const firstDay = {};
  for (const a of state.attempts) if (!firstDay[a.conceptId] || a.day < firstDay[a.conceptId]) firstDay[a.conceptId] = a.day;
  const introduced = new Set(Object.keys(firstDay));
  for (const it of state.items) if (it.srs && it.srs.state !== "new") introduced.add(it.conceptId);
  const introducedToday = Object.values(firstDay).filter(d => d === today).length;

  // ── 1. Due reviews, one per concept ────────────────────────────────────────
  const byConcept = {};
  let laterToday = 0;
  for (const it of state.items) {
    if (exclude.has(it.id)) continue;
    const srs = it.srs;
    if (!srs || srs.state === "new" || srs.due == null || srs.due > end) continue;
    const c = ix.concept[it.conceptId];
    if (!isEligible(ix, c)) continue;
    const learning = srs.state === "learning" || srs.state === "relearning";
    if (learning && srs.due > now + 5 * 60000) { laterToday++; continue; }
    const r = retrievability(srs, now) ?? 0;
    const cur = byConcept[c.id];
    const better = !cur || (learning && !cur.learning) || (learning === cur.learning && r < cur.r);
    if (better) byConcept[c.id] = { item: it, concept: c, learning, r };
  }

  const scored = Object.values(byConcept).map(x => {
    const dependents = (ix.dependentsOf[x.concept.id] || []).length;
    const course = ix.course[x.concept.courseId];
    const overdueDays = Math.max(0, (now - x.item.srs.due) / DAY_MS);
    const priority = x.learning ? 1000 + (1 - x.r)
      : (1 - x.r) * (IMPORTANCE[x.concept.importance]?.weight ?? 0.75)
        * (1 + 0.1 * Math.min(dependents, 5))
        * (course.status === "maintain" ? 0.9 : 1)
        + 0.02 * Math.min(overdueDays, 30);
    return { ...x, priority, estSec: est[x.item.ability] ?? 60 };
  }).sort((a, b) => b.priority - a.priority);

  const reviews = [];
  let used = 0, deferred = 0, learningCount = 0;
  for (const x of scored) {
    const forced = x.learning && learningCount < LEARNING_ALWAYS_MAX;
    if (forced || used + x.estSec <= budgetSec || (reviews.length === 0 && budgetSec > 0)) {
      reviews.push({ itemId: x.item.id, conceptId: x.concept.id, courseId: x.concept.courseId, kind: x.learning ? "learning" : "review", estSec: x.estSec });
      used += x.estSec;
      if (x.learning) learningCount++;
    } else {
      deferred++;
    }
  }

  // ── 2. How much new material can we afford? ────────────────────────────────
  let newCap = Math.max(0, s.maxNewPerDay - introducedToday);
  let throttle = null;
  if (deferred > 0) { newCap = 0; throttle = "backlog"; }
  else {
    const { sec } = forecastLoad(state, { now, days: 8 });
    const weekAvg = sec.slice(1).reduce((a, b) => a + b, 0) / 7;
    const ratio = weekAvg / Math.max(60, s.dailyMinutes * 60);
    if (ratio > 0.9) { newCap = 0; throttle = "forecast"; }
    else if (ratio > 0.7) { newCap = Math.ceil(newCap / 2); throttle = newCap ? "forecast-half" : "forecast"; }
  }

  const inPlan = new Set(reviews.map(t => t.conceptId));

  // Deepen: unseen tasks (e.g. applications) for concepts you've already learned.
  const deepen = [];
  for (const [cid, items] of Object.entries(ix.itemsByConcept)) {
    if (inPlan.has(cid) || !introduced.has(cid)) continue;
    const c = ix.concept[cid];
    if (!isEligible(ix, c) || ix.course[c.courseId].status !== "active") continue;
    const seen = items.filter(i => i.srs && i.srs.state !== "new");
    const graduated = seen.length > 0 && seen.every(i => i.srs.state === "review" && i.srs.stability >= 2);
    const next = items.find(i => (!i.srs || i.srs.state === "new") && !exclude.has(i.id));
    if (graduated && next) deepen.push({ item: next, concept: c });
  }
  deepen.sort((a, b) => (IMPORTANCE[a.concept.importance].rank - IMPORTANCE[b.concept.importance].rank)
    || (a.concept.createdAt - b.concept.createdAt));

  // Frontier: new concepts whose (confident) prerequisites are already started.
  const frontierByCourse = {};
  for (const course of state.courses) {
    if (course.status !== "active") continue;
    const list = [];
    for (const sec of ix.sectionsByCourse[course.id] || []) {
      for (const c of ix.conceptsBySection[sec.id] || []) {
        if (c.suspended || introduced.has(c.id)) continue;
        const items = (ix.itemsByConcept[c.id] || []).filter(i => !exclude.has(i.id));
        if (!items.length) continue;
        const ready = (ix.prereqsOf[c.id] || []).every(e => {
          if ((e.confidence ?? 1) < PROVISIONAL) return true;
          const p = ix.concept[e.from];
          if (!p || p.suspended || !(ix.itemsByConcept[p.id] || []).length) return true;
          if (!isEligible(ix, p)) return true;
          return introduced.has(p.id);
        });
        if (ready) list.push({ concept: c, item: items[0], sectionOrder: sec.order });
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
  let remaining = budgetSec - used;
  let deepenCap = Math.max(2, newCap);
  let di = 0;
  let progress = true;
  while (progress && remaining > 0) {
    progress = false;
    if (di < deepen.length && deepenCap > 0) {
      const d = deepen[di++];
      const cost = est[d.item.ability] ?? 60;
      if (cost <= remaining) {
        newPicks.push({ itemId: d.item.id, conceptId: d.concept.id, courseId: d.concept.courseId, kind: "deepen", estSec: cost });
        remaining -= cost; deepenCap--; progress = true;
      }
    }
    for (const courseId of courseOrder) {
      if (newCap <= 0) break;
      const list = frontierByCourse[courseId];
      while (cursors[courseId] < list.length && inPlan.has(list[cursors[courseId]].concept.id)) cursors[courseId]++;
      if (cursors[courseId] >= list.length) continue;
      const f = list[cursors[courseId]];
      const cost = Math.round((est[f.item.ability] ?? 60) * NEW_CONCEPT_FACTOR);
      if (cost > remaining) continue;
      cursors[courseId]++;
      inPlan.add(f.concept.id);
      newPicks.push({ itemId: f.item.id, conceptId: f.concept.id, courseId, kind: "new", estSec: cost });
      remaining -= cost; newCap--; progress = true;
    }
  }

  // ── 3. Interleave ──────────────────────────────────────────────────────────
  const tasks = interleave(reviews, newPicks);
  const estSec = tasks.reduce((s2, t) => s2 + t.estSec, 0);
  const byCourse = {};
  for (const t of tasks) {
    const b = (byCourse[t.courseId] ||= { courseId: t.courseId, count: 0, estSec: 0, fresh: 0 });
    b.count++; b.estSec += t.estSec;
    if (t.kind === "new") b.fresh++;
  }

  return {
    today, tasks, estSec, budgetSec, spentSec, deferred, laterToday, throttle,
    newCount: newPicks.filter(t => t.kind === "new").length,
    deepenCount: newPicks.filter(t => t.kind === "deepen").length,
    dueConcepts: scored.length,
    byCourse: Object.values(byCourse).sort((a, b) => b.count - a.count),
  };
}

/**
 * Extra practice on a chosen scope (a concept, a section, or a whole course).
 * One task per concept, weakest memory first; for a single concept, all of its tasks.
 */
export function practiceTasks(state, { conceptId, sectionId, courseId, limit = 15, now = Date.now() }) {
  const ix = index(state);
  const est = abilityTimes(state);
  const task = (it, c) => ({ itemId: it.id, conceptId: c.id, courseId: c.courseId, kind: it.srs?.state === "new" ? "new" : "practice", estSec: est[it.ability] ?? 60 });
  if (conceptId) {
    const c = ix.concept[conceptId];
    return c ? (ix.itemsByConcept[conceptId] || []).map(it => task(it, c)) : [];
  }
  const concepts = sectionId ? (ix.conceptsBySection[sectionId] || []) : (ix.conceptsByCourse[courseId] || []);
  const picks = [];
  for (const c of concepts) {
    if (c.suspended) continue;
    const items = ix.itemsByConcept[c.id] || [];
    const seen = items.filter(i => i.srs && i.srs.state !== "new");
    let pick, r = 2;
    if (seen.length) {
      for (const it of seen) {
        const ri = retrievability(it.srs, now) ?? 0;
        if (ri < r) { r = ri; pick = it; }
      }
    } else if (items.length) { pick = items[0]; r = 1.5; }
    if (pick) picks.push({ t: task(pick, c), r });
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
  for (const it of state.items) {
    const d = it.srs?.due;
    if (d == null || it.srs.state === "new") continue;
    const k = dayKey(d, rolloverHour);
    counts[k] = (counts[k] || 0) + 1;
  }
  return (ts) => counts[dayKey(ts, rolloverHour)] || 0;
}
