import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyState, makeCourse, makeSection, makeConcept, makeItem } from "../src/lib/model.js";
import { newSrs, RATING } from "../src/lib/fsrs.js";
import { dayKey } from "../src/lib/time.js";
import { conceptMastery } from "../src/lib/mastery.js";
import { readyConcepts, testStatus, testTasks, testRating, lastTestAt, TEST_SIZE, TEST_EVERY_DAYS } from "../src/lib/masteryTest.js";
import { xpFor, totalXp, rankFor, rankName, rankStart, XP } from "../src/lib/xp.js";
import { streaks } from "../src/lib/history.js";
import { reducer } from "../src/state/reducer.js";

const DAY = 864e5;
const NOW = new Date(2026, 10, 8, 12).getTime();

const answer = (concept, item, dayOffset, verdict, extra = {}) => {
  const ts = NOW + dayOffset * DAY;
  return { ts, day: dayKey(ts, 4), itemId: item.id, conceptId: concept.id, courseId: concept.courseId, ability: item.ability, verdict, rating: verdict === "correct" ? 3 : 1, aided: false, mode: "session", ms: 1000, ...extra };
};

/** n concepts, each with a ladder of three steps; `ready` of them proven ready (right on days −9, −2 and −1). */
function world(n, ready) {
  const s = emptyState();
  const course = makeCourse({ name: "C" });
  const sec = makeSection({ courseId: course.id, title: "Ch 1" });
  s.courses.push(course); s.sections.push(sec);
  for (let k = 0; k < n; k++) {
    const c = makeConcept({ courseId: course.id, sectionId: sec.id, name: `Concept ${k}`, order: k });
    c.srs = { ...newSrs(), state: "review", stability: 9, difficulty: 5, lastReview: NOW - DAY, due: NOW + 9 * DAY, reps: 3 };
    s.concepts.push(c);
    const steps = [1, 3, 4].map(level => makeItem({ conceptId: c.id, ability: level === 1 ? "recall" : "apply", level, prompt: `Step ${level} of ${k}`, answer: "a" }));
    s.items.push(...steps);
    if (k < ready) s.attempts.push(answer(c, steps[0], -9 - k, "correct"), answer(c, steps[1], -2, "correct"), answer(c, steps[1], -1, "correct"));
  }
  return s;
}

test("a test is due once 20 concepts are ready, and then not again for a week", () => {
  assert.equal(testStatus(world(25, 19), NOW).available, false, "19 ready isn't enough");
  const s = world(25, 22);
  const st = testStatus(s, NOW);
  assert.equal(st.ready, 22);
  assert.equal(st.available, true);
  assert.equal(st.nextAt, null);
  // Taken today: the next one opens in a week, whatever is ready.
  const taken = { ...s, attempts: [...s.attempts, answer(s.concepts[24], s.items[72], 0, "incorrect", { mode: "test" })] };
  assert.equal(lastTestAt(taken), NOW);
  assert.equal(testStatus(taken, NOW + DAY).available, false);
  assert.equal(testStatus(taken, NOW + DAY).nextAt, NOW + TEST_EVERY_DAYS * DAY);
  assert.equal(testStatus(taken, NOW + TEST_EVERY_DAYS * DAY).available, true);
});

test("the test asks each of the longest-ready concepts its hardest step, once", () => {
  const s = world(25, 22);
  const tasks = testTasks(s, NOW, () => 0.5);
  assert.equal(tasks.length, TEST_SIZE);
  assert.equal(new Set(tasks.map(t => t.conceptId)).size, TEST_SIZE, "one question per concept");
  const longest = readyConcepts(s, NOW).slice(0, TEST_SIZE).map(r => r.concept.id).sort();
  assert.deepEqual(tasks.map(t => t.conceptId).sort(), longest);
  const items = Object.fromEntries(s.items.map(i => [i.id, i]));
  assert.ok(tasks.every(t => items[t.itemId].level === 4 && t.kind === "test"), "the top of each ladder");
});

test("a question that needs its code run, or one that was reported, is never the test question", () => {
  const s = world(1, 1);
  const [low, mid, top] = s.items;
  top.tests = { lang: "python", code: "assert f() == 1" };
  mid.flag = { reason: "unclear" };
  assert.equal(testTasks(s, NOW)[0].itemId, low.id);
  low.flag = { reason: "wrong" };
  assert.equal(readyConcepts(s, NOW).length, 0, "nothing left to ask it: not offered");
});

test("a right test answer masters the concept and schedules it as a good review", () => {
  const s = world(1, 1);
  const [c] = s.concepts;
  const top = s.items[2];
  assert.equal(testRating("correct"), RATING.GOOD);
  assert.equal(testRating("partial"), RATING.HARD);
  assert.equal(testRating("incorrect"), RATING.AGAIN);
  const after = reducer(s, { type: "attempt", itemId: top.id, verdict: "correct", rating: testRating("correct"), mode: "test", now: NOW });
  assert.equal(conceptMastery(after, c.id, NOW).status, "mastered");
  assert.ok(after.concepts[0].srs.due > s.concepts[0].srs.due, "pushed further out");
  const missed = reducer(s, { type: "attempt", itemId: top.id, verdict: "incorrect", rating: testRating("incorrect"), mode: "test", now: NOW });
  assert.notEqual(conceptMastery(missed, c.id, NOW).status, "mastered");
  assert.equal(conceptMastery(missed, c.id, NOW).ready, false, "back to reviews before another try");
});

test("XP: 10 for a right answer, 5 for partly right, 50 for a concept proven in the test", () => {
  assert.equal(xpFor({ verdict: "correct" }), XP.right);
  assert.equal(xpFor({ verdict: "partial" }), XP.partly);
  assert.equal(xpFor({ verdict: "incorrect" }), 0);
  assert.equal(xpFor({ verdict: "correct", aided: true }), 0, "a revealed answer earns nothing");
  assert.equal(xpFor({ verdict: "correct", mode: "test" }), XP.test);
  assert.equal(xpFor({ verdict: "partial", mode: "test" }), 0, "the test is right or not");
  assert.equal(xpFor({ verdict: "correct", mode: "pretest" }), 0);
  assert.equal(totalXp([{ verdict: "correct" }, { verdict: "partial" }, { verdict: "correct", mode: "test" }]), 65);
});

test("ranks run from 10th kyu down to 1st kyu, then up through the dan grades with no top", () => {
  assert.deepEqual([0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 20, 30].map(rankName),
    ["10th kyu", "9th kyu", "8th kyu", "7th kyu", "2nd kyu", "1st kyu", "1st dan", "2nd dan", "3rd dan", "4th dan", "11th dan", "21st dan"]);
  assert.deepEqual([0, 99, 100, 900, 1340, 8100, 10000, 12100].map(x => rankFor(x).name),
    ["10th kyu", "10th kyu", "9th kyu", "7th kyu", "7th kyu", "1st kyu", "1st dan", "2nd dan"]);
  const r = rankFor(1340);
  assert.equal(r.next, "6th kyu");
  assert.equal(r.toGo, 1600 - 1340);
  assert.equal(r.progress, (1340 - 900) / (1600 - 900));
  // Each grade takes a little longer than the one before, forever.
  for (let i = 1; i < 60; i++) assert.ok(rankStart(i + 1) - rankStart(i) > rankStart(i) - rankStart(i - 1));
  assert.equal(rankFor(1e9).dan, true);
});

test("streaks count days in a row with an answer; today counts once you have answered", () => {
  const counts = { "2026-11-01": 3, "2026-11-02": 5, "2026-11-03": 1, "2026-11-05": 9, "2026-11-06": 2, "2026-11-07": 4 };
  assert.deepEqual(streaks(counts, "2026-11-08"), { current: 3, best: 3, days: 6 }, "today not studied yet: the streak still stands");
  assert.deepEqual(streaks({ ...counts, "2026-11-08": 1 }, "2026-11-08"), { current: 4, best: 4, days: 7 });
  assert.equal(streaks(counts, "2026-11-09").current, 0, "a missed day ends it");
});
