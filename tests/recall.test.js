import { test } from "node:test";
import assert from "node:assert/strict";

import { nextRecall, dueForRecall, recallWhen, hasNotes, FIRST_RECALL_DAYS } from "../src/lib/recall.js";
import { makeShelfItem, updateShelfItem, shelfEntries, shelfStats } from "../src/lib/shelf.js";
import { emptyState, normalizeState } from "../src/lib/model.js";
import { reducer } from "../src/state/reducer.js";
import { mergeStates } from "../src/lib/sync.js";

const DAY = 864e5;
const T0 = Date.UTC(2026, 8, 29, 12);

test("a shelf item's first recall is scheduled once it has notes", () => {
  const b = makeShelfItem({ title: "Project Hail Mary", author: "Andy Weir", unitLabel: "pages", total: 476 });
  assert.equal(hasNotes(b), false);
  assert.equal(updateShelfItem(b, { done: 40 }, T0).recall, null);
  const noted = updateShelfItem(b, { description: "A teacher wakes up alone on a spaceship." }, T0);
  assert.equal(noted.recall.due, T0 + FIRST_RECALL_DAYS * DAY);
  assert.equal(updateShelfItem(noted, { thoughts: "Loved Rocky." }, T0 + DAY).recall.due, noted.recall.due, "more notes don't move it");
  const linked = updateShelfItem(makeShelfItem({ courseId: "c1" }), { description: "x" }, T0);
  assert.equal(linked.recall, null, "Tenax courses have real questions instead");
});

test("status, progress and dates stay in step", () => {
  let b = makeShelfItem({ title: "Dune", status: "want", total: 48 });
  b = updateShelfItem(b, { done: 3 }, T0);
  assert.equal(b.status, "active", "logging progress starts it");
  assert.equal(b.startedAt, T0);
  b = updateShelfItem(b, { status: "finished" }, T0 + 10 * DAY);
  assert.equal(b.done, 48);
  assert.equal(b.finishedAt, T0 + 10 * DAY);
  b = updateShelfItem(b, { done: 47 }, T0 + 11 * DAY);
  assert.equal(b.status, "active");
  assert.equal(b.finishedAt, null);
  b = updateShelfItem(b, { done: 48 }, T0 + 12 * DAY);
  assert.equal(b.status, "finished");
  const noPages = updateShelfItem(makeShelfItem({ title: "Sapiens" }), { status: "finished" }, T0);
  assert.equal(noPages.finishedAt, T0, "a book with no page count can still be finished");
  assert.equal(updateShelfItem(noPages, { status: "want" }, T0).finishedAt, null);
});

test("recalls spread out when you remember, and come back soon when you don't", () => {
  let r = { due: T0, interval: 3, count: 0, history: [] };
  const intervals = [];
  for (let i = 0; i < 5; i++) { r = nextRecall(r, 3, T0); intervals.push(r.interval); }
  assert.deepEqual(intervals, [8, 20, 50, 125, 313]);
  assert.equal(nextRecall(r, 3, T0).interval, 365, "at most a year apart");
  assert.equal(nextRecall(r, 1, T0).interval, 2, "forgot: again in two days");
  assert.equal(nextRecall({ interval: 3 }, 4, T0).interval, 14);
  assert.equal(nextRecall({ interval: 10 }, 2, T0).interval, 12);
  assert.equal(recallWhen({ due: T0 + 8 * DAY - 60000 }, T0), "in 8 days");
  assert.equal(recallWhen({ due: T0 }, T0), "today");
});

test("the shelf shows what's due, and a recall can add to the notes", () => {
  let s = emptyState();
  const act = (type, payload, now) => { s = reducer(s, { type, now, ...payload }); };
  const book = makeShelfItem({ title: "Sapiens", status: "finished", description: "How humans came to rule the planet." });
  act("shelf/add", { item: book }, T0);
  assert.equal(s.shelf[0].finishedAt, T0);
  assert.deepEqual(dueForRecall(s.shelf, T0 + DAY), []);
  assert.equal(dueForRecall(s.shelf, T0 + 3 * DAY).length, 1);
  const entries = shelfEntries(s, T0 + 3 * DAY);
  assert.equal(entries[0].recallDue, true);
  assert.equal(entries[0].finished, true);
  assert.equal(shelfStats(entries).due, 1);
  act("shelf/recall", { id: book.id, rating: 3, note: "The cognitive revolution and shared myths." }, T0 + 3 * DAY);
  assert.equal(s.shelf[0].recall.interval, 8);
  assert.match(s.shelf[0].thoughts, /^2026-10-02: The cognitive revolution/);
});

test("books from the old Reading tab move onto the shelf, once, even when synced from an old computer", () => {
  const old = {
    ...emptyState(), version: 6,
    reading: [
      { id: "rb_1", title: "Dune", author: "Frank Herbert", status: "finished", rating: 5, about: "Spice.", thoughts: "Great.", ideas: "", totalPages: 0, currentPage: 0, finishedAt: T0, recall: { due: T0 + 3 * DAY, interval: 3, count: 0, history: [] }, createdAt: T0, updatedAt: T0 },
      { id: "rb_2", title: "Hyperion", status: "reading", totalPages: 480, currentPage: 120, createdAt: T0, updatedAt: T0 },
      { id: "rb_3", title: "Deleted later", status: "want", createdAt: T0, updatedAt: T0 },
    ],
  };
  const s = normalizeState(old);
  assert.equal(s.reading, undefined);
  assert.equal(s.shelf.length, 3);
  const dune = s.shelf.find(x => x.id === "sh_rb_1");
  assert.equal(dune.description, "Spice.");
  assert.equal(dune.rating, 5);
  assert.equal(dune.recall.interval, 3);
  const e = shelfEntries(s, T0).find(x => x.key === "sh_rb_1");
  assert.equal(e.finished, true, "finished without a page count");
  assert.equal(shelfEntries(s, T0).find(x => x.key === "sh_rb_2").done, 120);
  assert.equal(shelfEntries(s, T0).find(x => x.key === "sh_rb_3").want, true);
  assert.equal(normalizeState(s).shelf.length, 3, "migrating again changes nothing");

  // Another computer, still on the old version, deleted one of them; this one merges its copy.
  const other = { ...old, reading: old.reading.slice(0, 2), tombstones: { rb_3: T0 + DAY } };
  const merged = mergeStates(s, [{ deviceName: "LAPTOP", state: other }]).state;
  assert.deepEqual(merged.shelf.map(x => x.id).sort(), ["sh_rb_1", "sh_rb_2"]);
});
