// The mastery test: once a week, when at least 20 concepts are ready (see
// lib/mastery.js: right on two days, the latest two days right, and held for
// a week), a test of 20 questions, one per concept, with nothing to lean on:
// no lesson, no fresh wording, no feedback until the end. Each concept is
// asked its hardest step. A right answer masters the concept; anything else
// sends it back to reviews to be proven in a later test.
//
// Answers are recorded as attempts with mode "test", which is all the rest
// of the app needs: mastery, the schedule, XP and when the last test was.

import { index, levelOf } from "./model.js";
import { conceptMastery } from "./mastery.js";
import { hasTests } from "./code.js";
import { RATING } from "./fsrs.js";

export const TEST_SIZE = 20;
export const TEST_EVERY_DAYS = 7;

/** Concepts ready to be proven, the longest-held first: [{ concept, heldSince }]. */
export function readyConcepts(state, now = Date.now()) {
  const ix = index(state);
  const out = [];
  for (const c of state.concepts) {
    if (c.suspended || ix.lockedConcepts.has(c.id)) continue;
    if (!askable(ix, c.id)) continue;
    const m = conceptMastery(state, c.id, now);
    if (m.ready) out.push({ concept: c, heldSince: m.heldSince ?? now });
  }
  return out.sort((a, b) => a.heldSince - b.heldSince);
}

/** When the last mastery test was taken, or null. */
export const lastTestAt = (state) => state.attempts.reduce((m, a) => (a.mode === "test" && a.ts > (m ?? 0) ? a.ts : m), null);

/**
 * Whether a test can be taken now: { available, ready (how many concepts are
 * ready), nextAt (when the week since the last test is up, or null) }.
 */
export function testStatus(state, now = Date.now()) {
  const ready = readyConcepts(state, now).length;
  const last = lastTestAt(state);
  const nextAt = last ? last + TEST_EVERY_DAYS * 864e5 : null;
  return { available: ready >= TEST_SIZE && (!nextAt || now >= nextAt), ready, nextAt };
}

/** The question a concept is tested on: its hardest step that can be marked without running code. */
function testItem(ix, conceptId) {
  const items = (ix.itemsByConcept[conceptId] || []).filter(i => !i.flag && !hasTests(i));
  if (!items.length) return null;
  const lastAsked = (i) => (ix.attemptsByConcept[conceptId] || []).reduce((m, a) => (a.itemId === i.id && a.ts > m ? a.ts : m), 0);
  return [...items].sort((a, b) => levelOf(b) - levelOf(a) || lastAsked(a) - lastAsked(b))[0];
}
const askable = (ix, conceptId) => Boolean(testItem(ix, conceptId));

/**
 * The test: one question for each of the TEST_SIZE longest-ready concepts,
 * shuffled so a course's questions don't come in a row.
 */
export function testTasks(state, now = Date.now(), random = Math.random) {
  const ix = index(state);
  const tasks = readyConcepts(state, now).slice(0, TEST_SIZE).map(({ concept }) => {
    const item = testItem(ix, concept.id);
    return { itemId: item.id, conceptId: concept.id, courseId: concept.courseId, kind: "test" };
  });
  for (let i = tasks.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
  }
  return tasks;
}

/** How an answer in the test is scheduled: right is a good review, partly right a hard one, anything else a miss. */
export const testRating = (verdict) => (verdict === "correct" ? RATING.GOOD : verdict === "partial" ? RATING.HARD : RATING.AGAIN);
