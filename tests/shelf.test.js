import { test } from "node:test";
import assert from "node:assert/strict";

import { shelfEntries, shelfStats, fromAeroShelf, makeShelfItem, courseChapters } from "../src/lib/shelf.js";
import { emptyState, makeCourse, makeSection, normalizeState } from "../src/lib/model.js";
import { reducer } from "../src/state/reducer.js";
import { mergeStates } from "../src/lib/sync.js";

const T0 = Date.UTC(2026, 8, 29, 12);

/** Two Tenax courses (one an imported book, part-read and part-imported) and nothing on the shelf yet. */
function world() {
  let s = emptyState();
  let t = T0;
  const act = (type, payload = {}) => { s = reducer(s, { type, now: t++, ...payload }); };
  const kr = makeCourse({ name: "The C Programming Language" });
  const sql = makeCourse({ name: "SQLite" });
  act("course/add", { course: kr });
  act("course/add", { course: sql });
  const chapters = ["1 Tutorial", "2 Types", "3 Control Flow"].map((title, i) => makeSection({ courseId: kr.id, title, locked: i === 2 }));
  for (const section of chapters) act("section/add", { section });
  act("book/start", { job: { id: "job1", courseId: kr.id, bookId: "b1", title: "K&R", status: "running", chapters: [
    { title: "1", include: true, status: "done" }, { title: "2", include: true, status: "done" }, { title: "3", include: true, status: "done" },
    { title: "4 Functions", include: true, status: "pending" }, { title: "Index", include: false, status: "pending" },
  ] } });
  return { get: () => s, act, kr, sql };
}

test("Tenax courses are on the shelf on their own, with chapters read out of all chapters", () => {
  const { get, kr, sql } = world();
  assert.deepEqual(courseChapters(get(), kr.id), { read: 2, chapters: 4 }, "2 read; the unread and still-importing chapters count, the skipped one doesn't");
  const entries = shelfEntries(get(), T0);
  assert.equal(entries.length, 2);
  const k = entries.find(e => e.course?.id === kr.id);
  assert.equal(k.kind, "book", "an imported book");
  assert.equal(k.done, 2);
  assert.equal(k.total, 4);
  assert.equal(k.linked, true);
  assert.equal(entries.find(e => e.course?.id === sql.id).kind, "course");
  assert.deepEqual(shelfStats(entries), { count: 2, active: 2, finished: 0, pct: 2 / 4 });
});

test("dressing up a course, adding standalone items, hiding and finishing", () => {
  const { get, act, kr, sql } = world();
  act("shelf/add", { item: makeShelfItem({ courseId: kr.id, cover: "data:image/jpeg;base64,xx", description: "The classic.", total: 8 }) });
  act("shelf/add", { item: makeShelfItem({ title: "Dune", kind: "book", total: 48, done: 48 }) });
  act("shelf/add", { item: makeShelfItem({ courseId: sql.id, kind: "course", hidden: true }) });
  const entries = shelfEntries(get(), T0);
  assert.equal(entries.length, 3, "a course with an item isn't listed twice");
  const k = entries.find(e => e.course?.id === kr.id);
  assert.equal(k.title, "The C Programming Language", "follows the course's name");
  assert.equal(k.cover, "data:image/jpeg;base64,xx");
  assert.equal(k.total, 8, "your total wins when it's larger");
  const dune = entries.find(e => e.title === "Dune");
  assert.equal(dune.finished, true);
  assert.equal(entries.at(-1).title, "Dune", "finished items go last");
  const stats = shelfStats(entries);
  assert.equal(stats.count, 2, "hidden ones don't count");
  assert.equal(stats.finished, 1);
});

test("deleting a course keeps its shelf item, with the progress it had", () => {
  const { get, act, kr } = world();
  act("shelf/add", { item: makeShelfItem({ courseId: kr.id, total: 8 }) });
  act("course/delete", { id: kr.id });
  const [e] = shelfEntries(get(), T0);
  assert.equal(e.linked, false);
  assert.equal(e.title, "The C Programming Language");
  assert.equal(e.done, 2);
  assert.equal(e.total, 8);
});

test("AeroShelf items come across, linked to matching courses, without duplicates", () => {
  const { get, act, kr } = world();
  act("shelf/add", { item: makeShelfItem({ title: "Dune", total: 48 }) });
  const aero = { as_items: [
    { id: "a1", title: "The C Programming Language (2nd Edition)", kind: "book", unitLabel: "chapters", total: 8, done: 3, description: "K&R", image: "data:image/jpeg;base64,AAA", createdAt: 5 },
    { id: "a2", title: "dune", kind: "book", total: 48, done: 10 },
    { id: "a3", title: "CS50", kind: "course", unitLabel: "", total: 11, done: 20, image: "https://example.com/x.png" },
    { id: "a4", title: "  " },
  ] };
  const { items, linked, skipped } = fromAeroShelf(aero, get());
  assert.equal(items.length, 2);
  assert.equal(skipped, 2, "Dune is already there; the untitled one is dropped");
  assert.equal(items[0].courseId, kr.id, "linked by a close title");
  assert.deepEqual(linked, [{ title: "The C Programming Language (2nd Edition)", course: kr.name }]);
  assert.equal(items[0].cover, "data:image/jpeg;base64,AAA");
  const cs50 = items[1];
  assert.equal(cs50.kind, "course");
  assert.equal(cs50.unitLabel, "modules");
  assert.equal(cs50.done, 11, "clamped to the total");
  assert.equal(cs50.cover, null, "only embedded images are kept");
  act("shelf/import", { items });
  assert.equal(fromAeroShelf(aero, get()).items.length, 0, "importing twice adds nothing");
  assert.equal(shelfEntries(get(), T0).length, 4);
});

test("the shelf syncs like everything else", () => {
  const { get } = world();
  const base = normalizeState(JSON.parse(JSON.stringify(get())));
  let a = base, b = normalizeState(JSON.parse(JSON.stringify(base)));
  const item = makeShelfItem({ title: "Dune", total: 48 });
  a = reducer(a, { type: "shelf/add", item, now: T0 + 1000 });
  b = reducer(b, { type: "shelf/add", item: makeShelfItem({ title: "Neuromancer", total: 24 }), now: T0 + 2000 });
  a = reducer(a, { type: "shelf/update", id: item.id, patch: { done: 5 }, now: T0 + 3000 });
  const merged = mergeStates(a, [{ deviceName: "B", state: b }]).state;
  assert.deepEqual(merged.shelf.map(x => x.title).sort(), ["Dune", "Neuromancer"]);
  assert.equal(merged.shelf.find(x => x.title === "Dune").done, 5);
  const removed = reducer(merged, { type: "shelf/remove", id: item.id, now: T0 + 4000 });
  assert.equal(mergeStates(b, [{ deviceName: "A", state: removed }]).state.shelf.some(x => x.id === item.id), false, "removal carries over");
});

test("a course built a chapter at a time isn't 'finished' just because you're caught up; logged chapters count", () => {
  const { get, act, sql } = world();
  for (const title of ["Basics", "Transactions"]) act("section/add", { section: makeSection({ courseId: sql.id, title }) });
  let e = shelfEntries(get(), T0).find(x => x.course?.id === sql.id);
  assert.equal(e.total, 0, "no known total");
  assert.equal(e.done, 2);
  assert.equal(e.finished, false);
  // Read 5 chapters before using Tenax, and the book has 10.
  act("shelf/add", { item: makeShelfItem({ courseId: sql.id, kind: "book", done: 5, total: 10 }) });
  e = shelfEntries(get(), T0).find(x => x.course?.id === sql.id);
  assert.equal(e.done, 5, "the higher of Tenax's count and yours");
  assert.equal(e.read, 2);
  assert.equal(e.pct, 0.5);
});
