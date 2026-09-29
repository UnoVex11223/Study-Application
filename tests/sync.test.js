import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeStates, fingerprint } from "../src/lib/sync.js";
import { reducer } from "../src/state/reducer.js";
import { emptyState, makeCourse, makeSection, makeConcept, makeItem, makeEdge, normalizeState, index } from "../src/lib/model.js";
import { newNotes } from "../src/lib/notes.js";

const T0 = Date.UTC(2026, 8, 1, 12);
const clone = (s) => normalizeState(JSON.parse(JSON.stringify(s)));

/** A small library, as it would be on both computers right after syncing. */
function base() {
  let s = emptyState();
  const course = makeCourse({ name: "C" });
  const sec = makeSection({ courseId: course.id, title: "Pointers" });
  const concepts = ["X", "Y", "Z"].map((n, i) => makeConcept({ courseId: course.id, sectionId: sec.id, name: n, order: i }));
  const items = concepts.map(c => makeItem({ conceptId: c.id, ability: "explain", prompt: `Explain ${c.name}`, answer: "a", points: ["a"] }));
  let t = T0;
  const act = (type, payload = {}) => { s = reducer(s, { type, now: t++, ...payload }); };
  act("course/add", { course });
  act("section/add", { section: sec });
  act("import", { payload: { concepts, items } });
  return { state: s, course, concepts, items };
}
const actor = (initial, start) => {
  let s = initial, t = start;
  return { act: (type, payload = {}) => { s = reducer(s, { type, now: t++, ...payload }); }, get: () => s };
};

test("changes are stamped and deletions leave a marker; loading isn't an edit", () => {
  const { state, concepts, items } = base();
  assert.ok(state.courses[0].updatedAt >= T0);
  const a = actor(state, T0 + 1000);
  a.act("concept/delete", { id: concepts[2].id });
  assert.equal(a.get().tombstones[concepts[2].id], T0 + 1000);
  assert.equal(a.get().tombstones[items[2].id], T0 + 1000, "its question is marked deleted too");
  assert.equal(a.get().tombstones[items[0].id], undefined);
  a.act("settings", { patch: { dailyMinutes: 30 } });
  assert.equal(a.get().settingsUpdatedAt, T0 + 1001);
  const loaded = reducer(a.get(), { type: "load", state: a.get(), now: T0 + 5000 });
  assert.equal(loaded.settingsUpdatedAt, T0 + 1001, "loading from disk isn't stamped as an edit");
  const restored = reducer(a.get(), { type: "replace", state: a.get(), now: T0 + 6000 });
  assert.equal(restored.settingsUpdatedAt, T0 + 6000, "a restore is: it has to win on the other computers");
  assert.ok(restored.concepts.every(c => c.updatedAt === T0 + 6000));
});

test("two computers that studied separately end up with the same library", () => {
  const { state, course, concepts, items } = base();
  const A = actor(clone(state), T0 + 10_000);
  const B = actor(clone(state), T0 + 20_000);

  // Computer A: reviews X, captures a note.
  A.act("attempt", { itemId: items[0].id, verdict: "correct", rating: 3 });
  A.act("notes/add", { notes: newNotes(A.get(), [{ text: "WAL mode lets readers keep reading while one writer writes." }]).notes });
  // Computer B: reviews Y, renames the course, deletes Z, adds a link.
  B.act("attempt", { itemId: items[1].id, verdict: "incorrect", rating: 1 });
  B.act("course/update", { id: course.id, patch: { name: "The C Programming Language" } });
  B.act("concept/delete", { id: concepts[2].id });
  B.act("edges/add", { edges: [makeEdge({ type: "prereq", from: concepts[0].id, to: concepts[1].id })] });

  const onA = mergeStates(A.get(), [{ deviceName: "B", state: B.get() }]);
  const onB = mergeStates(B.get(), [{ deviceName: "A", state: A.get() }]);
  assert.equal(onA.changed, true);
  assert.equal(fingerprint(onA.state), fingerprint(onB.state), "both computers converge");

  const s = onA.state, ix = index(s);
  assert.equal(s.attempts.length, 2, "review history from both");
  assert.equal(s.courses[0].name, "The C Programming Language");
  assert.deepEqual(s.concepts.map(c => c.name).sort(), ["X", "Y"], "the deletion carried over, with its question");
  assert.ok(!s.items.some(i => i.conceptId === concepts[2].id));
  assert.equal(ix.concept[concepts[0].id].srs.state, "learning", "X's schedule from A");
  assert.equal(ix.concept[concepts[1].id].srs.state, "learning", "Y's schedule from B");
  assert.equal(s.notes.length, 1);
  assert.equal(s.edges.length, 1);

  // Merging again changes nothing.
  assert.equal(mergeStates(s, [{ deviceName: "B", state: onB.state }]).changed, false);
});

test("when the same thing changed on both, the newer edit wins; an edit after a deletion keeps it", () => {
  const { state, course, concepts } = base();
  const A = actor(clone(state), T0 + 10_000);
  const B = actor(clone(state), T0 + 20_000);
  A.act("course/update", { id: course.id, patch: { name: "Older name" } });
  B.act("course/update", { id: course.id, patch: { name: "Newer name" } });
  A.act("concept/delete", { id: concepts[0].id });           // deleted at ~T0+10001
  B.act("concept/update", { id: concepts[0].id, patch: { name: "X, edited later" } }); // edited at ~T0+20001
  B.act("concept/update", { id: concepts[1].id, patch: { name: "Y, edited earlier" } });
  const A2 = actor(A.get(), T0 + 30_000);
  A2.act("concept/delete", { id: concepts[1].id });          // deleted after B's edit

  const s = mergeStates(A2.get(), [{ deviceName: "B", state: B.get() }]).state;
  assert.equal(s.courses[0].name, "Newer name");
  const names = s.concepts.map(c => c.name).sort();
  assert.ok(names.includes("X, edited later"), "edited after the delete: kept");
  assert.ok(!names.some(n => n.startsWith("Y")), "deleted after the edit: gone");
});

test("an edit to an older record on the other computer is noticed", () => {
  const { state, concepts } = base();
  const A = actor(clone(state), T0 + 10_000);
  const B = actor(clone(state), T0 + 20_000);
  A.act("concept/update", { id: concepts[2].id, patch: { name: "Z newest on A" } });
  B.act("concept/update", { id: concepts[0].id, patch: { name: "X on B" } });
  const A3 = actor(A.get(), T0 + 50_000);
  A3.act("concept/update", { id: concepts[1].id, patch: { name: "Y, even newer on A" } });
  const r = mergeStates(A3.get(), [{ deviceName: "B", state: B.get() }]);
  assert.equal(r.changed, true);
  assert.ok(r.state.concepts.some(c => c.name === "X on B"));
});

test("a copy from a newer version of the app is left alone", () => {
  const { state } = base();
  const future = { ...clone(state), version: 99, courses: [] };
  const r = mergeStates(state, [{ deviceName: "LAPTOP", state: future }]);
  assert.equal(r.changed, false);
  assert.deepEqual(r.skipped, ["LAPTOP"]);
  assert.equal(r.state, state);
});

test("the same link or note made on two computers is kept once", () => {
  const { state, concepts } = base();
  const A = actor(clone(state), T0 + 10_000);
  const B = actor(clone(state), T0 + 20_000);
  for (const X of [A, B]) {
    X.act("edges/add", { edges: [makeEdge({ type: "related", from: concepts[0].id, to: concepts[1].id })] });
    X.act("notes/add", { notes: newNotes(X.get(), [{ text: "Same note typed on both computers today." }]).notes });
  }
  const s = mergeStates(A.get(), [{ deviceName: "B", state: B.get() }]).state;
  assert.equal(s.edges.length, 1);
  assert.equal(s.notes.length, 1);
});

test("restoring a backup wins on the other computers too", () => {
  const { state, course, concepts } = base();
  const backup = clone(state);
  const A = actor(clone(state), T0 + 10_000);
  const B = actor(clone(state), T0 + 20_000);
  B.act("course/update", { id: course.id, patch: { name: "Renamed on B" } });
  A.act("concept/delete", { id: concepts[1].id }); // removed on A, then A restores the old backup
  const A2 = actor(A.get(), T0 + 30_000);
  const restoredOnly = { ...backup, concepts: backup.concepts.filter(c => c.id !== concepts[0].id) };
  A2.act("replace", { state: restoredOnly });
  const s = mergeStates(B.get(), [{ deviceName: "A", state: A2.get() }]).state;
  assert.equal(s.courses[0].name, "C", "the restored name, not B's earlier rename");
  assert.deepEqual(s.concepts.map(c => c.name).sort(), ["Y", "Z"], "exactly what the backup had");
});

test("a restore doesn't bring back what this computer deleted since, via another computer", () => {
  const { state, course } = base();
  const backup = clone(state);
  const A = actor(clone(state), T0 + 10_000);
  const extra = makeSection({ courseId: course.id, title: "Added later" });
  A.act("section/add", { section: extra });
  const B = actor(clone(A.get()), T0 + 20_000); // B syncs the new section
  A.act("section/delete", { id: extra.id });   // A deletes it again (B never edits it)
  const A2 = actor(A.get(), T0 + 30_000);
  A2.act("replace", { state: backup });
  const s = mergeStates(A2.get(), [{ deviceName: "B", state: B.get() }]).state;
  assert.ok(!s.sections.some(x => x.id === extra.id));
});
