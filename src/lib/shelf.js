// The shelf: every book and course you're working through, with its cover and
// how far along you are.
//
// Your Tenax courses are on it automatically, with progress taken from the
// chapters you've read in Tenax (or what you log by hand, if that's more:
// chapters you read before using Tenax count too). Anything you only want to
// track, like a novel or a video course, is added by hand and counted with
// + and −. A course built a chapter at a time has no known total until you
// set one, so it's never shown as finished just because you're caught up.
// A shelf item with a courseId dresses up a Tenax course (cover, its own
// total); one without is a standalone entry.
//
// Three kinds, each with its own tab: reading (books you read for their own
// sake), textbooks and courses (what you study). Reading books also keep notes
// in your own words, a star rating and dates, and Tenax asks you to recall
// them now and then (see lib/recall.js).

import { uid, index } from "./model.js";
import { courseMastery } from "./mastery.js";
import { hasNotes, firstRecall } from "./recall.js";

export const SHELF_KINDS = {
  reading: { label: "Book", unit: "pages", category: "reading" },
  textbook: { label: "Textbook", unit: "chapters", category: "study" },
  course: { label: "Course", unit: "modules", category: "study" },
};

export const categoryOf = (kind) => SHELF_KINDS[kind]?.category ?? "study";

export const makeShelfItem = (fields = {}) => ({
  id: uid("sh"), kind: "reading", title: "", author: "", description: "", cover: null,
  unitLabel: SHELF_KINDS[fields.kind]?.unit || "pages", total: 0, done: 0, courseId: null, hidden: false,
  status: "active", rating: 0, thoughts: "", ideas: "", recall: null, startedAt: null, finishedAt: null,
  createdAt: Date.now(), ...fields,
});

/** A standalone item is finished when it's all logged, or marked finished if it has no total. */
export const itemFinished = (it) => (it.total > 0 ? (it.done || 0) >= it.total : it.status === "finished");

/** The item with its fields changed, keeping dates, status and the first recall in step. */
export function updateShelfItem(it, patch, now = Date.now()) {
  const next = { ...it, ...patch };
  if (patch.status === "finished" && next.total > 0) next.done = next.total;
  if (patch.status === "active" && itemFinished(next) && next.total > 0 && patch.done == null) next.done = Math.max(0, next.total - 1);
  if (next.status === "want" && (next.done || 0) > 0 && patch.status !== "want") next.status = "active";
  if (patch.status === "want") next.done = 0;
  const was = itemFinished(it), is = itemFinished(next);
  if (is && next.status !== "finished") next.status = "finished";
  if (!is && next.status === "finished") next.status = "active";
  if (is && !next.finishedAt) next.finishedAt = now;
  if (!is && was && patch.finishedAt == null) next.finishedAt = null;
  if (next.status !== "want" && !next.startedAt && ((next.done || 0) > 0 || patch.status === "active")) next.startedAt = now;
  if (next.kind === "reading" && !next.courseId && !next.recall && hasNotes(next)) next.recall = firstRecall(now);
  return next;
}

/** Chapters of a Tenax course: how many there are, and how many you've read. */
export function courseChapters(state, courseId, ix = index(state)) {
  const sections = ix.sectionsByCourse[courseId] || [];
  const read = sections.filter(s => !s.locked).length;
  // Chapters of a book import that aren't in the course yet still count.
  const waiting = state.bookJobs
    .filter(j => j.courseId === courseId)
    .reduce((n, j) => n + j.chapters.filter(c => c.include !== false && c.status !== "done").length, 0);
  return { read, chapters: sections.length + waiting };
}

const isFinished = (e) => e.total > 0 && e.done >= e.total;

/**
 * Everything on the shelf, ready to show: your items, plus every Tenax course
 * that doesn't have one yet. Each entry:
 * { key, item | null, course | null, title, kind, category, description, cover,
 *   unit, total, done, pct, finished, linked, mastery, hidden }
 */
export function shelfEntries(state, now = Date.now()) {
  const ix = index(state);
  const courses = state.courses.filter(c => c.kind !== "notes");
  const byCourse = new Map();
  for (const it of state.shelf) if (it.courseId && ix.course[it.courseId]) byCourse.set(it.courseId, it);

  const fromCourse = (course, item) => {
    const { read, chapters } = courseChapters(state, course.id, ix);
    const booky = state.bookJobs.some(j => j.courseId === course.id);
    // A book import knows all its chapters; otherwise only the total you set counts.
    const total = item?.total > 0 ? Math.max(item.total, chapters) : booky ? chapters : 0;
    const logged = Math.max(item?.done || 0, read);
    const done = total ? Math.min(logged, total) : logged;
    return {
      key: item ? item.id : `course:${course.id}`, item: item || null, course,
      title: item?.title || course.name,
      kind: item && categoryOf(item.kind) === "study" ? item.kind : booky ? "textbook" : "course",
      description: "",
      cover: item?.cover || null,
      unit: item?.unitLabel || "chapters",
      total, done, read, linked: true, hidden: Boolean(item?.hidden),
      mastery: courseMastery(state, course.id, now).masteryPct,
      author: item?.author || "", rating: item?.rating || 0, want: false, recallDue: false,
      createdAt: item?.createdAt ?? course.createdAt, finishedAt: null,
    };
  };

  const out = [];
  for (const it of state.shelf) {
    const course = it.courseId ? ix.course[it.courseId] : null;
    if (course && course.kind !== "notes") { out.push(fromCourse(course, it)); continue; }
    const finished = itemFinished(it);
    out.push({
      key: it.id, item: it, course: null, title: it.title, kind: it.kind,
      description: it.kind === "reading" ? it.description || "" : "",
      cover: it.cover || null, unit: it.unitLabel || SHELF_KINDS[it.kind]?.unit || "chapters",
      total: it.total || 0, done: it.total > 0 ? Math.min(it.done || 0, it.total) : (it.done || 0), read: 0, linked: false, hidden: Boolean(it.hidden),
      mastery: null, author: it.author || "", rating: it.rating || 0,
      want: it.kind === "reading" && it.status === "want" && !finished, finishedFlag: finished,
      recallDue: Boolean(it.kind === "reading" && hasNotes(it) && it.recall && it.recall.due <= now),
      createdAt: it.createdAt, finishedAt: it.finishedAt || null,
    });
  }
  for (const c of courses) if (!byCourse.has(c.id)) out.push(fromCourse(c, null));

  for (const e of out) {
    e.category = categoryOf(e.kind);
    e.finished = e.finishedFlag ?? isFinished(e);
    e.pct = e.total > 0 ? e.done / e.total : e.finished ? 1 : 0;
    delete e.finishedFlag;
  }
  // In progress first (most recently added first), then want to read, then finished (most recent first).
  const group = (e) => (e.finished ? 2 : e.want ? 1 : 0);
  return out.sort((a, b) => group(a) - group(b)
    || (group(a) === 2 ? (b.finishedAt || b.createdAt || 0) - (a.finishedAt || a.createdAt || 0) : (b.createdAt || 0) - (a.createdAt || 0)));
}

/** Totals for the stats row (hidden entries don't count). */
export function shelfStats(entries) {
  const shown = entries.filter(e => !e.hidden);
  const counted = shown.filter(e => e.total > 0); // without a total there's no percentage to add up
  const units = counted.reduce((n, e) => n + e.total, 0);
  const unitsDone = counted.reduce((n, e) => n + e.done, 0);
  const finished = shown.filter(e => e.finished).length;
  const want = shown.filter(e => e.want).length;
  return {
    count: shown.length, active: shown.length - finished - want, finished, want,
    due: shown.filter(e => e.recallDue).length, pct: units ? unitsDone / units : 0,
  };
}

/** The shelf's tabs. The kind tabs also set what "Add" starts with. */
export const SHELF_FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "reading", label: "Reading", kind: "reading", test: (e) => e.kind === "reading" },
  { id: "textbook", label: "Textbooks", kind: "textbook", test: (e) => e.kind === "textbook" },
  { id: "course", label: "Courses", kind: "course", test: (e) => e.kind === "course" },
  { id: "active", label: "In progress", test: (e) => !e.finished && !e.want },
  { id: "done", label: "Finished", test: (e) => e.finished },
];

/**
 * A year on the shelf: what you finished (things with a finish date), in the
 * order you finished them, with totals and the months they fall in.
 * { years (with something finished, newest first, always including this one),
 *   finished, books, pages, study, rating (average of the rated, or null), byMonth: [12 × entries] }
 */
export function yearOnShelf(entries, year, now = Date.now()) {
  const dated = entries.filter(e => e.finished && e.finishedAt && !e.hidden);
  const yearOf = (ts) => new Date(ts).getFullYear();
  const years = [...new Set([yearOf(now), ...dated.map(e => yearOf(e.finishedAt))])].sort((a, b) => b - a);
  const finished = dated.filter(e => yearOf(e.finishedAt) === year).sort((a, b) => a.finishedAt - b.finishedAt);
  const books = finished.filter(e => e.category === "reading");
  const pages = books.reduce((n, e) => n + (/^pages?$/i.test(e.unit || "") ? e.total || 0 : 0), 0);
  const rated = books.filter(e => e.rating > 0);
  const byMonth = Array.from({ length: 12 }, () => []);
  for (const e of finished) byMonth[new Date(e.finishedAt).getMonth()].push(e);
  return {
    years, finished, books: books.length, pages, study: finished.length - books.length,
    rating: rated.length ? rated.reduce((n, e) => n + e.rating, 0) / rated.length : null, byMonth,
  };
}
