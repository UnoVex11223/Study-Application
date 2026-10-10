import { test } from "node:test";
import assert from "node:assert/strict";

import { findFrame, coverFit, stripColor, clothFor, CLOTH, bookThickness } from "../src/lib/cover.js";

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

test("book-shaped pictures fill the cover; banners and squares are framed", () => {
  assert.equal(coverFit(2 / 3), "fill");
  assert.equal(coverFit(0.7), "fill");
  assert.equal(coverFit(1), "framed");
  assert.equal(coverFit(16 / 9), "framed");
  assert.equal(coverFit(0.4), "framed");
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
