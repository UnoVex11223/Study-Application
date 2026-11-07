// Ladders. A concept's questions are steps, each testing one piece of
// knowledge and adding one thing to the step below (model.js LEVELS): its
// vocabulary, one rule, a small problem, a twist, and using it with what it
// builds on. That's how a good tutor breaks an idea down, and it's why a
// right answer can feel like progress.
//
//  - A new concept is taught first (its lesson: the terms and a worked
//    example), then asked its first steps in a row, stopping at the first miss.
//  - Each review asks the lowest step you haven't answered right yet, so the
//    ladder is climbed one review at a time and a missed step is asked again
//    next time. Once every step is climbed, the steps take turns, the one
//    asked longest ago first, so the vocabulary comes back too.
//  - Terms drill: every started concept's first step (its vocabulary),
//    rapid-fire, for drilling definitions on purpose.
//
// Pure and unit-tested (tests/ladder.test.js).

import { index, levelOf, LEVELS } from "./model.js";
import { retrievability } from "./fsrs.js";

/** Steps asked in a row when a concept is new (the first included). */
export const INTRO_STEPS = 3;

/** A concept's questions in ladder order (lowest step first), without the ones taken out of sessions. */
export function ladderOf(ix, conceptId, { exclude } = {}) {
  return (ix.itemsByConcept[conceptId] || []).filter(i => !i.flag && !exclude?.has(i.id));
}

/** A step is climbed once its most recent answer was right without help. */
export const climbed = (ix, item) => Boolean(ix.itemStats[item.id]?.lastOk);

/**
 * Where you are on a concept's ladder.
 * { steps: [{ item, level, label, climbed }], climbed, total, next } — next is the lowest step not yet climbed.
 */
export function ladderProgress(state, conceptId) {
  const ix = index(state);
  const steps = ladderOf(ix, conceptId).map(item => ({ item, level: levelOf(item), label: LEVELS[levelOf(item)].label, climbed: climbed(ix, item) }));
  return {
    steps,
    climbed: steps.filter(s => s.climbed).length,
    total: steps.length,
    next: steps.find(s => !s.climbed)?.item ?? null,
  };
}

/** The step a review should ask: the lowest one not climbed, or (all climbed) the one asked longest ago. */
export function reviewStep(ix, items) {
  const next = items.find(i => !climbed(ix, i));
  if (next) return next;
  let best = items[0];
  for (const it of items) if ((ix.itemStats[it.id]?.lastSeen ?? 0) < (ix.itemStats[best.id]?.lastSeen ?? 0)) best = it;
  return best;
}

/**
 * The step to ask after `itemId` while a new concept is being introduced:
 * the next one up, if the introduction has room for it. `asked` counts the
 * steps asked so far in this introduction (the first included).
 */
export function introNext(ix, conceptId, itemId, asked) {
  if (asked >= INTRO_STEPS) return null;
  const steps = ladderOf(ix, conceptId);
  const at = steps.findIndex(i => i.id === itemId);
  if (at < 0) return null;
  return steps.slice(at + 1).find(i => levelOf(i) > levelOf(steps[at])) ?? null;
}

/** Has this concept's set of questions been written (or rebuilt) as a ladder? */
export function hasLadder(ix, concept) {
  if (concept.ladderAt) return true;
  const items = ix.itemsByConcept[concept.id] || [];
  return items.length > 0 && items.every(i => i.level != null || !i.quality);
}

const started = (ix, c) => (c.srs && c.srs.state !== "new") || (ix.attemptsByConcept[c.id] || []).length > 0;

/**
 * Terms drill: the vocabulary step of every started concept in a course (or
 * one chapter), the ones you're shakiest on first. Concepts you haven't
 * started aren't drilled: that would be a test on something never taught.
 */
export function termTasks(state, { courseId, sectionId = null, limit = 40, now = Date.now() }) {
  const ix = index(state);
  const concepts = sectionId ? (ix.conceptsBySection[sectionId] || []) : (ix.conceptsByCourse[courseId] || []);
  const picks = [];
  for (const c of concepts) {
    if (c.suspended || ix.lockedConcepts.has(c.id) || !started(ix, c)) continue;
    for (const it of ladderOf(ix, c.id)) {
      if (levelOf(it) !== 1) continue;
      const st = ix.itemStats[it.id];
      // Missed last time first, then never asked, then by how close the concept is to being forgotten.
      const rank = (st?.seen && !st.lastOk ? 0 : !st?.seen ? 1 : 2) + (retrievability(c.srs, now) ?? 0.5);
      picks.push({ task: { itemId: it.id, conceptId: c.id, courseId: c.courseId, kind: "drill" }, rank });
    }
  }
  return picks.sort((a, b) => a.rank - b.rank).slice(0, limit).map(p => p.task);
}

/**
 * A course's glossary: the terms its concepts' lessons introduce, A to Z.
 * [{ term, definition, conceptId, conceptName, started }]
 */
export function glossary(state, courseId) {
  const ix = index(state);
  const seen = new Set(), out = [];
  for (const c of ix.conceptsByCourse[courseId] || []) {
    if (c.suspended || ix.lockedConcepts.has(c.id)) continue;
    for (const t of c.lesson?.terms || []) {
      const key = String(t.term || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ term: t.term.trim(), definition: String(t.definition || "").trim(), conceptId: c.id, conceptName: c.name, started: started(ix, c) });
    }
  }
  return out.sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
}

/** A lesson from what Claude wrote for a concept: { terms, example, diagram } (null when there's nothing to teach). */
export function makeLesson({ terms = [], example = "", diagram = null } = {}) {
  const t = (terms || [])
    .map(x => ({ term: String(x?.term || "").trim(), definition: String(x?.definition || "").trim() }))
    .filter(x => x.term && x.definition)
    .slice(0, 4);
  const ex = String(example || "").trim();
  if (!t.length && !ex && !diagram) return null;
  return { terms: t, example: ex, diagram: diagram || null };
}
