import { test } from "node:test";
import assert from "node:assert/strict";

import { findFrame, bookShaped, coverWindow, coverPlan, edgeDetail, focusOf, stripColor, clothFor, CLOTH, bookThickness } from "../src/lib/cover.js";

const WHITE = [252, 252, 250], BLACK = [4, 4, 6], RED = [150, 40, 30], BLUE = [70, 120, 220];

/** An RGBA picture of w×h filled with bg, with each [x0, y0, x1, y1, color] painted on top. */
function picture(w, h, bg, rects = []) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hit = rects.findLast(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
      const c = hit ? hit[4] : bg;
      const i = (y * w + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return px;
}

test("a scanned cover loses the paper around it", () => {
  const px = picture(100, 140, WHITE, [[8, 10, 92, 130, RED]]);
  assert.deepEqual(findFrame(px, 100, 140), { l: 8, t: 10, r: 92, b: 130 });
});

test("a banner with white strips above and below loses the strips, not its dark sides", () => {
  // Black banner, white bands top and bottom; the sides are black right to the edge.
  const px = picture(160, 100, WHITE, [[0, 4, 160, 88, BLACK], [40, 30, 60, 60, RED], [100, 20, 140, 70, BLUE]]);
  assert.deepEqual(findFrame(px, 160, 100), { l: 0, t: 4, r: 160, b: 88 });
});

test("a white cover keeps its white space when text, not an edge, ends the margin", () => {
  // A cover that is white itself: a thin line of title text, then a big shape.
  const px = picture(100, 150, WHITE, [[30, 20, 70, 23, RED], [20, 50, 80, 110, BLUE]]);
  assert.deepEqual(findFrame(px, 100, 150), { l: 0, t: 0, r: 100, b: 150 });
});

test("one band on its own is part of the design, not a margin", () => {
  // A black footer strip across the bottom of a white cover.
  const px = picture(100, 150, WHITE, [[0, 130, 100, 150, BLACK], [20, 30, 80, 90, BLUE]]);
  assert.deepEqual(findFrame(px, 100, 150), { l: 0, t: 0, r: 100, b: 150 });
});

test("nothing is cropped from a picture that's all edge, or would lose more than half", () => {
  assert.deepEqual(findFrame(picture(50, 70, RED), 50, 70), { l: 0, t: 0, r: 50, b: 70 });
  const tiny = picture(100, 100, WHITE, [[45, 45, 55, 55, RED]]); // margins of 45%: above the 30% limit
  assert.deepEqual(findFrame(tiny, 100, 100), { l: 0, t: 0, r: 100, b: 100 });
});

test("pictures of another shape are cut to a book's shape, along the side with room to spare", () => {
  assert.ok(bookShaped(2 / 3) && bookShaped(0.68), "a book's shape, give or take a little");
  assert.ok(!bookShaped(0.75) && !bookShaped(1) && !bookShaped(16 / 9));
  assert.deepEqual(coverWindow(300, 300, 0), { x: 0, y: 0, w: 200, h: 300 }, "a square loses a third of its width");
  assert.deepEqual(coverWindow(300, 300, 1), { x: 100, y: 0, w: 200, h: 300 });
  assert.deepEqual(coverWindow(100, 300, 0.5), { x: 0, y: 75, w: 100, h: 150 }, "a tall picture is cut top and bottom");
});

test("a picture with plain sides is extended to fit; one with busy sides is cut", () => {
  // A square cover: a title right across it, on a plain background above and below.
  const title = [[4, 40, 96, 48, WHITE], [10, 55, 90, 60, RED]];
  assert.deepEqual(coverPlan(picture(100, 100, BLACK, title), 100, 100), { fit: "extend", before: 0.5 }, "the whole title stays");
  // Lettering touching the top: only the bottom is carried on.
  const top = [...title, ...Array.from({ length: 12 }, (_, i) => [4 + i * 8, 0, 8 + i * 8, 6, WHITE])];
  assert.ok(edgeDetail(picture(100, 100, BLACK, top), 100, { l: 0, t: 0, r: 100, b: 100 }, "t") > 6);
  assert.deepEqual(coverPlan(picture(100, 100, BLACK, top), 100, 100), { fit: "extend", before: 0 });
  // A tall poster with plain sides gets room left and right.
  assert.deepEqual(coverPlan(picture(60, 150, BLUE, [[20, 30, 40, 120, RED]]), 60, 150), { fit: "extend", before: 0.5 });
  // Busy right to the edges: cut, where the detail is.
  const busy = Array.from({ length: 50 }, (_, i) => [i * 2, 0, i * 2 + 1, 100, WHITE]);
  assert.equal(coverPlan(picture(100, 100, BLACK, busy), 100, 100).fit, "cut");
  assert.deepEqual(coverPlan(picture(100, 150, BLACK, busy), 100, 150), { fit: "fill" });
});

test("the cut keeps the part of a picture with the most going on", () => {
  // A wide banner: plain blue, with the title lettering (stripes) at the right.
  const stripes = Array.from({ length: 10 }, (_, i) => [200 + i * 8, 30, 204 + i * 8, 70, WHITE]);
  const cut = coverWindow(300, 100, focusOf(picture(300, 100, BLUE, stripes), 300, 100));
  assert.ok(Math.abs(cut.x - 200) < 8, "the cut starts where the lettering does");
  // A tall poster with a face (detail) near the top.
  const face = [[30, 20, 70, 60, WHITE], [40, 30, 45, 35, BLACK], [55, 30, 60, 35, BLACK], [45, 45, 55, 50, RED]];
  assert.ok(focusOf(picture(100, 300, BLUE, face), 100, 300) < 0.15);
  assert.equal(focusOf(picture(300, 100, BLUE), 300, 100), 0.5, "a plain picture is cut in the middle");
  assert.equal(focusOf(picture(100, 150, BLUE, stripes), 100, 150), 0.5, "a book-shaped one isn't cut");
});

test("the spine takes the colour of the cover's left edge", () => {
  const px = picture(100, 100, WHITE, [[0, 0, 10, 100, RED]]);
  assert.deepEqual(stripColor(px, 100, { l: 0, t: 0, r: 100, b: 100 }), RED);
});

test("a book without a picture always gets the same cloth", () => {
  assert.equal(clothFor("Dune"), clothFor("  dune "));
  assert.ok(CLOTH.includes(clothFor("The Pragmatic Programmer")));
  const picked = new Set(["Dune", "Sapiens", "SICP", "Clean Code", "Refactoring", "Hyperion", "Neuromancer", "Godel, Escher, Bach"].map(clothFor));
  assert.ok(picked.size >= 3, "titles spread over the colours");
});

test("thicker books for more pages, within limits", () => {
  const thin = bookThickness({ category: "reading", unit: "pages", total: 120 });
  const thick = bookThickness({ category: "reading", unit: "pages", total: 900 });
  assert.ok(thin < thick);
  assert.equal(bookThickness({ category: "reading", unit: "pages", total: 5000 }), 26);
  assert.equal(bookThickness({ category: "study", unit: "chapters", total: 0 }), 14);
  assert.equal(bookThickness({ category: "study", unit: "chapters", total: 10 }), bookThickness({ category: "reading", unit: "pages", total: 300 }));
});

test("spine text is light on dark spines and dark on light ones", async () => {
  const { inkFor, parseColor, spineHeight } = await import("../src/lib/cover.js");
  assert.deepEqual(parseColor("rgb(10, 20, 30)"), [10, 20, 30]);
  assert.deepEqual(parseColor("#FF8000"), [255, 128, 0]);
  assert.equal(parseColor("nonsense"), null);
  assert.equal(inkFor("#1C1E23"), "#EDEAE3");
  assert.equal(inkFor("rgb(240, 236, 226)"), "#1F1C17");
  assert.equal(inkFor(null), "#EDEAE3");
  const book = spineHeight({ category: "reading", title: "Dune" }), text = spineHeight({ category: "study", title: "Dune" });
  assert.ok(book < text, "books stand shorter than textbooks");
  assert.equal(spineHeight({ category: "reading", title: "Dune" }), book, "always the same for a title");
});

test("a title is laid out in full: one line when it fits, more lines or smaller type when it doesn't", async () => {
  const { fitTitle } = await import("../src/lib/cover.js");
  const measure = (text, size) => text.length * size * 0.5; // every character half as wide as the type is tall
  const short = fitTitle("Dune", { length: 140, across: 24, measure });
  assert.deepEqual(short, { size: 13, lines: ["Dune"], across: 24 });

  // Too long for one line at full size, so it goes on two lines when the spine is wide enough...
  const two = fitTitle("CS50: Introduction to Computer Science", { length: 140, across: 32, measure });
  assert.equal(two.lines.length, 2);
  assert.equal(two.lines.join(" "), "CS50: Introduction to Computer Science", "nothing left out");
  assert.ok(two.lines.every(l => measure(l, two.size) <= 140));
  assert.ok(two.lines.length * two.size * 1.12 <= 32);

  // ...and stays on one line in smaller type when it isn't.
  const one = fitTitle("CS50: Introduction to Computer Science", { length: 140, across: 14, measure });
  assert.equal(one.lines.length, 1);
  assert.ok(one.size < 13 && measure(one.lines[0], one.size) <= 140);

  // A very long title never ends in "…": it asks for more room across instead.
  const long = "A Very Long Title About The Complete History and Practice of Database Systems Engineering";
  const fit = fitTitle(long, { length: 120, across: 24, measure });
  assert.equal(fit.lines.join(" "), long);
  assert.ok(!fit.lines.some(l => l.includes("…")));
  assert.ok(fit.across >= Math.ceil(fit.lines.length * fit.size * 1.12));
  assert.ok(fit.lines.every(l => measure(l, fit.size) <= 120 + 1e-9));
});

test("lines are balanced, not filled greedily", async () => {
  const { fitTitle } = await import("../src/lib/cover.js");
  const measure = (text, size) => text.length * size * 0.5;
  const fit = fitTitle("The Pragmatic Programmer", { length: 80, across: 40, measure });
  assert.deepEqual(fit.lines, ["The Pragmatic", "Programmer"]);
});
