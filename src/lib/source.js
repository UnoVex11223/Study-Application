// Finding a quote in the source it was taken from.
//
// When concepts are extracted, Claude copies a short passage for each one "as
// written". Two things depend on that being true: the quote is shown to you as
// your source's own words, and the text around it is what the question writer
// and reviewer read so their questions agree with what your material says
// (they don't see the whole chapter). So every quote is looked up here: one
// that isn't in the source is discarded, and one that is brings its
// surroundings along.
//
// Matching ignores case, spacing, punctuation, line-break hyphens and the
// [Page N] markers of PDF text. Pure and unit-tested (tests/source.test.js).

const PAGE = /\[Page \d+\]/g;
const LETTER = /[\p{L}\p{N}]/u;
const MIN_FRAGMENT = 16; // letters and digits; shorter quotes match by accident
const ANCHOR = 30;

/** A source prepared for lookups: its letters and digits in a row, each remembering where it came from. */
export function sourceIndex(text) {
  const src = String(text || "");
  const skip = new Uint8Array(src.length);
  for (const m of src.matchAll(PAGE)) skip.fill(1, m.index, m.index + m[0].length);
  let stream = "";
  const at = [];
  for (let i = 0; i < src.length; i++) {
    if (skip[i] || !LETTER.test(src[i])) continue;
    const ch = src[i].toLowerCase();
    // A character that lowercases to several is kept as one, so positions stay aligned.
    stream += ch.length === 1 ? ch : src[i];
    at.push(i);
  }
  return { src, stream, at };
}

const letters = (s) => [...String(s || "").replace(PAGE, " ")].filter(ch => LETTER.test(ch)).map(ch => (ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch)).join("");

/**
 * Where a quote sits in the source: { start, end } (character offsets), or
 * null when it isn't there. A quote with an ellipsis is matched by its
 * longest run.
 */
export function locateQuote(ix, quote) {
  const parts = String(quote || "").split(/\.{3,}|…|\[\.\.\.\]/).map(letters).filter(p => p.length >= MIN_FRAGMENT);
  if (!parts.length) return null;
  const longest = parts.reduce((a, b) => (b.length > a.length ? b : a));
  const i = ix.stream.indexOf(longest);
  if (i < 0) return null;
  return { start: ix.at[i], end: ix.at[i + longest.length - 1] + 1 };
}

/** The source around a located quote, cut at word boundaries: about `pad` characters each side. */
export function passageAt(ix, where, pad = 700) {
  let from = Math.max(0, where.start - pad), to = Math.min(ix.src.length, where.end + pad);
  while (from > 0 && /\S/.test(ix.src[from - 1])) from--;
  while (to < ix.src.length && /\S/.test(ix.src[to])) to++;
  return ix.src.slice(from, to).replace(PAGE, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Check one concept's quote against the source. Returns { excerpt, passage }:
 * the quote if it is really there (otherwise empty), and the text around it.
 */
export function groundQuote(ix, quote) {
  const where = locateQuote(ix, quote);
  if (where) return { excerpt: String(quote).trim(), passage: passageAt(ix, where) };
  // Not the source's words as written (so not shown as a quote), but if its
  // opening or closing run is there, that is still where the concept came from.
  const all = letters(quote);
  if (all.length < 2 * ANCHOR) return { excerpt: "", passage: "" };
  for (const anchor of [all.slice(0, ANCHOR), all.slice(-ANCHOR)]) {
    const i = ix.stream.indexOf(anchor);
    if (i >= 0) return { excerpt: "", passage: passageAt(ix, { start: ix.at[i], end: ix.at[i + anchor.length - 1] + 1 }) };
  }
  return { excerpt: "", passage: "" };
}
