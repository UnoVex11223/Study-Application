import { test } from "node:test";
import assert from "node:assert/strict";

import { shelfEntries, shelfStats, makeShelfItem, updateShelfItem, courseChapters, SHELF_FILTERS } from "../src/lib/shelf.js";
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
  assert.equal(k.kind, "textbook", "an imported book");
  assert.equal(k.category, "study");
  assert.equal(k.done, 2);
  assert.equal(k.total, 4);
  assert.equal(k.linked, true);
  assert.equal(entries.find(e => e.course?.id === sql.id).kind, "course");
  assert.deepEqual(shelfStats(entries), { count: 2, active: 2, finished: 0, want: 0, due: 0, pct: 2 / 4 });
});

test("dressing up a course, adding standalone items, hiding and finishing", () => {
  const { get, act, kr, sql } = world();
  act("shelf/add", { item: makeShelfItem({ courseId: kr.id, cover: "data:image/jpeg;base64,xx", description: "The classic.", total: 8 }) });
  act("shelf/add", { item: makeShelfItem({ title: "Dune", kind: "reading", total: 48, done: 48 }) });
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

test("reading and study are separate: textbooks and courses have no description, notes or recalls", () => {
  const { get, act, kr } = world();
  act("shelf/add", { item: makeShelfItem({ courseId: kr.id, kind: "textbook", description: "old blurb" }) });
  act("shelf/add", { item: makeShelfItem({ title: "CS50", kind: "course", unitLabel: "modules", total: 11 }) });
  act("shelf/add", { item: makeShelfItem({ title: "Dune", kind: "reading", description: "Spice.", total: 600 }) });
  const entries = shelfEntries(get(), T0);
  const by = (t) => entries.find(e => e.title === t);
  assert.equal(by("Dune").category, "reading");
  assert.equal(by("Dune").description, "Spice.");
  assert.equal(by("CS50").category, "study");
  assert.equal(by("The C Programming Language").description, "", "no description on textbooks and courses");
  const tab = (id) => entries.filter(SHELF_FILTERS.find(f => f.id === id).test).map(e => e.title).sort();
  assert.deepEqual(tab("reading"), ["Dune"]);
  assert.deepEqual(tab("textbook"), ["The C Programming Language"]);
  assert.deepEqual(tab("course"), ["CS50", "SQLite"]);
  act("shelf/add", { item: makeShelfItem({ title: "SICP lectures", kind: "course", status: "want" }) });
  assert.equal(shelfEntries(get(), T0).find(e => e.title === "SICP lectures").want, false, "only books are 'want to read'");
  const course = updateShelfItem(makeShelfItem({ title: "CS50", kind: "course" }), { description: "x", thoughts: "y" }, T0);
  assert.equal(course.recall, null, "only reading books come up for recall");
});

test("books from before the split land in the right category", () => {
  const { get, kr } = world();
  const old = { ...JSON.parse(JSON.stringify(get())), version: 7, shelf: [
    makeShelfItem({ id: "sh_a", kind: "book", courseId: kr.id, unitLabel: "chapters" }),
    makeShelfItem({ id: "sh_rb_1", kind: "book", title: "Sapiens", unitLabel: "pages" }),
    makeShelfItem({ id: "sh_b", kind: "book", title: "Dune", author: "Frank Herbert", unitLabel: "chapters" }),
    makeShelfItem({ id: "sh_c", kind: "book", title: "Designing Data-Intensive Applications", unitLabel: "chapters", description: "From AeroShelf" }),
    makeShelfItem({ id: "sh_d", kind: "course", title: "CS50", unitLabel: "modules" }),
  ] };
  const s = normalizeState(old);
  assert.deepEqual(s.shelf.map(x => x.kind), ["textbook", "reading", "reading", "textbook", "course"]);
  assert.equal(s.version, 8);
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
  act("shelf/add", { item: makeShelfItem({ courseId: sql.id, kind: "textbook", done: 5, total: 10 }) });
  e = shelfEntries(get(), T0).find(x => x.course?.id === sql.id);
  assert.equal(e.done, 5, "the higher of Tenax's count and yours");
  assert.equal(e.read, 2);
  assert.equal(e.pct, 0.5);
});
