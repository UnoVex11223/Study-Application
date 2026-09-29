// Whole-book import: find the chapters in a PDF's outline, estimate the work,
// and turn one chapter's extraction + reviewed questions into store records.
// Pure functions; the job itself runs in src/state/bookImport.jsx.

import { buildImport } from "./ai.js";

// Front and back matter that isn't worth studying.
const MATTER = /^(cover|half[- ]?title|title page|copyright|(brief |detailed )?contents|table of contents|dedication|epigraph|acknowledg|preface|foreword|about (the|this) (author|authors|book)|index\b|bibliography|references\b|further reading|glossary|appendi(x|ces)|answers|solutions|end ?notes|notes\b|colophon|also by|praise for|list of (figures|tables|illustrations))/i;
const PART = /^(part|book|volume)\s+([ivxlc]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
const CHAPTER = /^(chapter|ch\.|lesson|unit|module|lecture)\s*[\divxlc]+|^\d{1,2}(\.|:|\)|\s)\s*\S/i;

export const isMatter = (title) => MATTER.test(String(title).trim());

/**
 * Chapters from a flattened outline ([{ title, page, depth, end }], depths 0–1).
 * A top-level entry that is a "Part" (or that mostly contains chapters) is
 * replaced by its children. Returns [{ title, from, to, include }].
 */
export function detectChapters(outline = [], pages = 0) {
  const top = [], childrenOf = new Map();
  let parent = null;
  for (const o of outline) {
    if (o.depth === 0) { parent = o; top.push(o); childrenOf.set(o, []); }
    else if (parent) childrenOf.get(parent).push(o);
  }
  const allKids = outline.filter(o => o.depth === 1);
  // One or two top entries (e.g. just the book's title) with chapters under them.
  const flatten = top.length < 3 && allKids.length >= 3;

  const picked = [];
  for (const t of top) {
    const kids = childrenOf.get(t);
    const chapterKids = kids.filter(k => CHAPTER.test(k.title)).length;
    const usesKids = kids.length > 0 && (flatten || PART.test(t.title) || (!CHAPTER.test(t.title) && chapterKids >= 2));
    if (usesKids) picked.push(...kids);
    else picked.push(t);
  }
  const seen = new Set();
  return picked
    .filter(o => o.end >= o.page && !seen.has(o.page) && seen.add(o.page))
    .map(o => ({ title: o.title || `Pages ${o.page}–${o.end}`, from: o.page, to: Math.min(o.end, pages || o.end), include: !isMatter(o.title) }));
}

/** Chapters typed in by hand: start pages → page ranges. */
export function chaptersFromStarts(rows, pages) {
  const sorted = rows.filter(r => r.from >= 1).sort((a, b) => a.from - b.from);
  return sorted.map((r, i) => ({
    title: r.title?.trim() || `Pages ${r.from}–${(sorted[i + 1]?.from ?? pages + 1) - 1}`,
    from: r.from, to: Math.max(r.from, (sorted[i + 1]?.from ?? pages + 1) - 1), include: true,
  }));
}

/**
 * Rough time and cost for importing the chosen chapters (Opus pricing, 2026).
 * About 3 cents a page live; question writing and review (roughly three
 * quarters of that) cost half through the Batch API.
 */
export function estimate(chapters, { batch = false } = {}) {
  const chosen = chapters.filter(c => c.include);
  const pages = chosen.reduce((n, c) => n + Math.max(1, c.to - c.from + 1), 0);
  const round = (x) => Math.max(1, Math.round(x));
  const factor = batch ? 0.62 : 1;
  return {
    chapters: chosen.length,
    pages,
    batch,
    minutes: batch ? [round(chosen.length * 1.2 + 8), round(chosen.length * 1.5 + 60)] : [round(chosen.length * 1.2 + 2), round(chosen.length * 2 + 4)],
    dollars: [round(pages * 0.02 * factor), round(pages * 0.04 * factor)],
  };
}

/**
 * Store records for one chapter: a single section named after the chapter
 * holding all of its concepts, locked until you mark it read.
 */
export function chapterImport({ state, courseId, chapter, extraction, groups, order, locked, alsoKnown = [] }) {
  const flat = {
    sections: [{
      title: chapter.title,
      summary: extraction.summary || extraction.sections.map(s => s.summary).filter(Boolean)[0] || "",
      concepts: extraction.sections.flatMap(s => s.concepts),
    }],
  };
  const label = `${chapter.title}, pp. ${chapter.from}–${chapter.to}`;
  const payload = buildImport({ state, courseId, extraction: flat, groups, sourceLabel: label, alsoKnown });
  payload.sections = payload.sections.map(s => ({ ...s, order, locked, pages: [chapter.from, chapter.to] }));
  return payload;
}
