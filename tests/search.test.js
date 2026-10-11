import { test } from "node:test";
import assert from "node:assert/strict";

import { fuzzy, rank, highlight } from "../src/lib/search.js";
import { lastDays, perDay, runningTotal, sparkPoints } from "../src/lib/history.js";

test("a substring beats scattered letters, and the start of a word beats the middle", () => {
  const sub = fuzzy("point", "Pointers to functions");
  const scattered = fuzzy("ptf", "Pointers to functions");
  assert.ok(sub && scattered);
  assert.ok(sub.score > scattered.score);
  assert.deepEqual(sub.hits, [0, 1, 2, 3, 4]);
  assert.ok(fuzzy("arr", "Arrays").score > fuzzy("arr", "Pointer arrays").score);
  assert.ok(fuzzy("arr", "Pointer arrays").score > fuzzy("arr", "Starry night").score);
});

test("scattered letters go to the starts of words, and stray letters don't count", () => {
  assert.deepEqual(fuzzy("ptf", "Pointers to functions").hits, [0, 9, 12]);
  assert.equal(fuzzy("xyz", "Pointers"), null);
  assert.equal(fuzzy("point", "The C Programming Language - 2nd Edition"), null);
  assert.ok(fuzzy("pinter", "Pointers"), "a missing letter still finds it");
});

test("every word of the query has to match, in any order", () => {
  assert.ok(fuzzy("functions point", "Pointers to functions"));
  assert.equal(fuzzy("point malloc", "Pointers to functions"), null);
});

test("ranking puts the best match first and falls back to the subtitle", () => {
  const items = [
    { title: "Call by value", sub: "The C Programming Language" },
    { title: "Pointers and addresses", sub: "The C Programming Language" },
    { title: "Pointer variable", sub: "C Programming: A Modern Approach" },
    { title: "Shelf" },
  ];
  const out = rank(items, "pointer");
  assert.deepEqual(out.map(o => o.title), ["Pointer variable", "Pointers and addresses"]);
  const bySub = rank(items, "value programming");
  assert.equal(bySub[0].title, "Call by value");
  assert.ok(bySub[0].hits.every(h => h < "Call by value".length), "only the title is highlighted");
  assert.equal(rank(items, "").length, 4);
  assert.equal(rank([{ title: "A", boost: 5 }, { title: "A" }], "a")[0].boost, 5);
});

test("highlighting splits the text into matched and plain runs", () => {
  assert.deepEqual(highlight("Shelf", [0, 1]), [{ text: "Sh", hit: true }, { text: "elf", hit: false }]);
  assert.deepEqual(highlight("ab", []), [{ text: "ab", hit: false }]);
});

test("day histories: the last days, counts per day, running totals", () => {
  const days = lastDays("2026-10-10", 3);
  assert.deepEqual(days, ["2026-10-08", "2026-10-09", "2026-10-10"]);
  const atts = [{ day: "2026-10-08" }, { day: "2026-10-10", ok: true }, { day: "2026-10-10" }, { day: "2026-09-01" }];
  assert.deepEqual(perDay(atts, days), [1, 0, 2]);
  assert.deepEqual(perDay(atts, days, a => a.ok), [0, 0, 1]);
  assert.deepEqual(runningTotal(["2026-09-30", "2026-10-09", null, "2026-10-09"], days), [1, 3, 3]);
});

test("sparkline points span the box, highest value at the top", () => {
  const pts = sparkPoints([0, 5, 10], 100, 20, 2);
  assert.deepEqual(pts[0], [2, 18]);
  assert.deepEqual(pts[2], [98, 2]);
  assert.equal(pts[1][1], 10);
  assert.deepEqual(sparkPoints([0, 0], 10, 10, 1).map(p => p[1]), [9, 9], "all zero stays on the floor");
  assert.deepEqual(sparkPoints([], 10, 10), []);
});
