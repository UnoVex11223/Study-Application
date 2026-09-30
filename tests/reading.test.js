import { test } from "node:test";
import assert from "node:assert/strict";

import { makeBook, updateBook, nextRecall, dueBooks, readingStats, recallWhen, hasNotes, FIRST_RECALL_DAYS } from "../src/lib/reading.js";
import { emptyState, normalizeState } from "../src/lib/model.js";
import { reducer } from "../src/state/reducer.js";
import { mergeStates } from "../src/lib/sync.js";

const DAY = 864e5;
const T0 = Date.UTC(2026, 8, 29, 12);

test("a book's first recall is scheduled once it has notes", () => {
  const b = makeBook({ title: "Project Hail Mary", author: "Andy Weir" });
  assert.equal(hasNotes(b), false);
  assert.equal(updateBook(b, { currentPage: 40 }, T0).recall, null);
  const noted = updateBook(b, { about: "A teacher wakes up alone on a spaceship." }, T0);
  assert.equal(noted.recall.due, T0 + FIRST_RECALL_DAYS * DAY);
  assert.equal(updateBook(noted, { thoughts: "Loved Rocky." }, T0 + DAY).recall.due, noted.recall.due, "more notes don't move it");
});

test("finishing and restarting a book keep its dates straight", () => {
  const b = updateBook(makeBook({ title: "Dune", status: "want" }), { status: "reading" }, T0);
  assert.equal(b.startedAt, T0);
  const done = updateBook(b, { status: "finished" }, T0 + 10 * DAY);
  assert.equal(done.finishedAt, T0 + 10 * DAY);
  assert.equal(updateBook(done, { status: "reading" }, T0 + 11 * DAY).finishedAt, null);
  assert.equal(updateBook(done, { status: "finished", finishedAt: 123 }, T0).finishedAt, 123);
});

test("recalls spread out when you remember a book, and come back soon when you don't", () => {
  let r = { due: T0, interval: 3, count: 0, history: [] };
  const intervals = [];
  for (let i = 0; i < 5; i++) { r = nextRecall(r, 3, T0); intervals.push(r.interval); }
  assert.deepEqual(intervals, [8, 20, 50, 125, 313]);
  assert.equal(nextRecall(r, 3, T0).interval, 365, "at most a year apart");
  assert.equal(nextRecall(r, 1, T0).interval, 2, "forgot: again in two days");
  assert.equal(nextRecall({ interval: 3 }, 4, T0).interval, 14);
  assert.equal(nextRecall({ interval: 10 }, 2, T0).interval, 12);
  assert.equal(r.count, 5);
  assert.equal(r.history.length, 5);
});

test("the reducer adds books, schedules and records recalls, and keeps recall notes", () => {
  let s = emptyState();
  const act = (type, payload, now) => { s = reducer(s, { type, now, ...payload }); };
  const book = makeBook({ title: "Sapiens", author: "Yuval Noah Harari", status: "finished", about: "How humans came to rule the planet." });
  act("reading/add", { book }, T0);
  assert.equal(s.reading[0].recall.due, T0 + 3 * DAY, "notes written when adding count");
  assert.deepEqual(dueBooks(s.reading, T0 + DAY), []);
  assert.equal(dueBooks(s.reading, T0 + 3 * DAY).length, 1);
  act("reading/recall", { id: book.id, rating: 3, note: "The cognitive revolution and shared myths." }, T0 + 3 * DAY);
  const b = s.reading[0];
  assert.equal(b.recall.count, 1);
  assert.equal(b.recall.interval, 8);
  assert.match(b.thoughts, /^2026-10-02: The cognitive revolution/);
  assert.equal(recallWhen(b.recall, T0 + 3 * DAY), "in 8 days");
  assert.equal(recallWhen(b.recall, b.recall.due), "today");
  act("reading/update", { id: book.id, patch: { rating: 4 } }, T0 + 4 * DAY);
  assert.equal(s.reading[0].rating, 4);
  assert.equal(s.reading[0].updatedAt, T0 + 4 * DAY, "changes are stamped for sync");
  act("reading/remove", { id: book.id }, T0 + 5 * DAY);
  assert.equal(s.reading.length, 0);
  assert.equal(s.tombstones[book.id], T0 + 5 * DAY);
});

test("stats count this year's finished books and what's due", () => {
  const books = [
    makeBook({ status: "reading" }),
    makeBook({ status: "finished", finishedAt: T0 - 5 * DAY, about: "x", recall: { due: T0 - DAY, interval: 3, count: 0, history: [] } }),
    makeBook({ status: "finished", finishedAt: Date.UTC(2025, 5, 1) }),
    makeBook({ status: "want" }),
  ];
  assert.deepEqual(readingStats(books, T0), { reading: 1, finishedThisYear: 1, finished: 2, due: 1 });
});

test("books sync between computers like everything else", () => {
  let a = emptyState();
  a = reducer(a, { type: "reading/add", book: makeBook({ title: "Dune" }), now: T0 });
  let b = normalizeState(JSON.parse(JSON.stringify(a)));
  b = reducer(b, { type: "reading/add", book: makeBook({ title: "Hyperion" }), now: T0 + 1000 });
  a = reducer(a, { type: "reading/update", id: a.reading[0].id, patch: { thoughts: "Spice everywhere." }, now: T0 + 2000 });
  const merged = mergeStates(a, [{ deviceName: "B", state: b }]).state;
  assert.deepEqual(merged.reading.map(x => x.title).sort(), ["Dune", "Hyperion"]);
  assert.equal(merged.reading.find(x => x.title === "Dune").thoughts, "Spice everywhere.");
});
