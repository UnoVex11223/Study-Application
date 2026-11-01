// What changed between two versions of the library (lib/delta.js), checked
// against real actions through the reducer.
import { test } from "node:test";
import assert from "node:assert/strict";

import { diffLibrary } from "../src/lib/delta.js";
import { emptyState, normalizeState, makeCourse, makeSection, makeConcept, makeItem } from "../src/lib/model.js";
import { reducer } from "../src/state/reducer.js";
import { mergeStates } from "../src/lib/sync.js";
import { RATING } from "../src/lib/fsrs.js";

const NOW = new Date(2026, 9, 31, 12).getTime();

function library() {
  let s = emptyState();
  const course = makeCourse({ name: "C" }, 0);
  const section = makeSection({ courseId: course.id });
  const concepts = [1, 2, 3].map(n => makeConcept({ courseId: course.id, sectionId: section.id, name: `k${n}` }));
  const items = concepts.map(c => makeItem({ conceptId: c.id, prompt: "q", answer: "a" }));
  s = { ...s, courses: [course], sections: [section], concepts, items };
  return normalizeState(s);
}
const act = (s, type, payload = {}, now = NOW) => reducer(s, { type, now, ...payload });

test("nothing changed: an empty delta", () => {
  const s = library();
  assert.equal(diffLibrary(s, s).empty, true);
});

test("answering a question sends the review and its concept, nothing else", () => {
  const s = library();
  const next = act(s, "attempt", { itemId: s.items[0].id, verdict: "correct", rating: RATING.GOOD, ms: 1000 });
  const d = diffLibrary(s, next);
  assert.equal(d.empty, false);
  assert.deepEqual(Object.keys(d.upsert), ["concepts"]);
  assert.deepEqual(d.upsert.concepts.map(c => c.id), [s.concepts[0].id]);
  assert.equal(d.attempts.length, 1);
  assert.deepEqual(d.remove, {});
  assert.deepEqual(d.meta, {});
});

test("deleting a concept sends its removal (with its questions) and the deletion markers", () => {
  const s = library();
  const next = act(s, "concept/delete", { id: s.concepts[1].id });
  const d = diffLibrary(s, next);
  assert.deepEqual(d.remove.concepts, [s.concepts[1].id]);
  assert.deepEqual(d.remove.items, [s.items[1].id]);
  assert.ok(d.tombstones.set[s.concepts[1].id] > 0, "the deletion carries over to other computers");
});

test("changing a setting sends the settings and when they changed", () => {
  const s = library();
  const next = act(s, "settings", { patch: { dailyQuestions: 30 } });
  const d = diffLibrary(s, next);
  assert.equal(d.meta.settings.dailyQuestions, 30);
  assert.equal(d.meta.settingsUpdatedAt, NOW);
  assert.deepEqual(d.upsert, {});
});

test("reviews that fall off the in-memory history are not deleted", () => {
  const s = { ...library(), attempts: [{ ts: 1, itemId: "a" }, { ts: 2, itemId: "b" }] };
  const next = { ...s, attempts: [s.attempts[1], { ts: 3, itemId: "c" }] };
  const d = diffLibrary(s, next);
  assert.deepEqual(d.attempts.map(a => a.ts), [3]);
  assert.equal("remove" in d && d.remove.attempts, undefined);
});

test("a sync merge sends only what arrived, not the whole library", () => {
  const s = library();
  const elsewhere = act(s, "concept/update", { id: s.concepts[2].id, patch: { name: "renamed elsewhere" } }, NOW + 1000);
  const { state: merged, changed } = mergeStates(s, [{ deviceName: "LAPTOP", state: elsewhere }]);
  assert.equal(changed, true);
  const d = diffLibrary(s, merged);
  assert.deepEqual(Object.keys(d.upsert), ["concepts"], "questions aren't rewritten just because they were normalized");
  assert.deepEqual(d.upsert.concepts.map(c => c.name), ["renamed elsewhere"]);
});

test("normalizing keeps questions that are already in shape as the same objects", () => {
  const s = library();
  const again = normalizeState(s);
  assert.ok(again.items.every((it, i) => it === s.items[i]));
  const old = normalizeState({ ...s, items: [{ ...s.items[0], srs: { state: "review" } }] });
  assert.equal("srs" in old.items[0], false, "an old question is still brought into shape");
});
