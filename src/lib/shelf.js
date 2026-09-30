// The shelf: every book and course you're working through, with its cover and
// how far along you are (this used to be a separate app, AeroShelf).
//
// Your Tenax courses are on it automatically, with progress taken from the
// chapters you've read in Tenax (or what you log by hand, if that's more:
// chapters you read before using Tenax count too). Anything you only want to
// track, like a novel or a video course, is added by hand and counted with
// + and −. A course built a chapter at a time has no known total until you
// set one, so it's never shown as finished just because you're caught up.
// A shelf item with a courseId dresses up a Tenax course (cover, description,
// its own total); one without is a standalone entry.
//
// Standalone items (books you read for fun, a video course…) also keep notes
// in your own words, a star rating and dates, and Tenax asks you to recall
// them now and then (see lib/recall.js). This used to be a separate Reading tab.

import { uid, index } from "./model.js";
import { courseMastery } from "./mastery.js";
import { hasNotes, firstRecall } from "./recall.js";

export const SHELF_KINDS = {
  book: { label: "Book", unit: "chapters" },
  course: { label: "Course", unit: "modules" },
};

export const SHELF_STATUS = {
  active: { label: "In progress" },
  finished: { label: "Finished" },
  want: { label: "Want to read" },
};

export const makeShelfItem = (fields = {}) => ({
  id: uid("sh"), kind: "book", title: "", author: "", description: "", cover: null,
  unitLabel: "chapters", total: 0, done: 0, courseId: null, hidden: false,
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
  if (!next.courseId && !next.recall && hasNotes(next)) next.recall = firstRecall(now);
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
 * { key, item | null, course | null, title, kind, description, cover, unit,
 *   total, done, pct, finished, linked, mastery, hidden }
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
      kind: item?.kind || (booky ? "book" : "course"),
      description: item?.description || "",
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
      key: it.id, item: it, course: null, title: it.title, kind: it.kind, description: it.description || "",
      cover: it.cover || null, unit: it.unitLabel || SHELF_KINDS[it.kind]?.unit || "chapters",
      total: it.total || 0, done: it.total > 0 ? Math.min(it.done || 0, it.total) : (it.done || 0), read: 0, linked: false, hidden: Boolean(it.hidden),
      mastery: null, author: it.author || "", rating: it.rating || 0,
      want: it.status === "want" && !finished, finishedFlag: finished,
      recallDue: Boolean(hasNotes(it) && it.recall && it.recall.due <= now),
      createdAt: it.createdAt, finishedAt: it.finishedAt || null,
    });
  }
  for (const c of courses) if (!byCourse.has(c.id)) out.push(fromCourse(c, null));

  for (const e of out) {
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

export const SHELF_FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "book", label: "Books", test: (e) => e.kind === "book" },
  { id: "course", label: "Courses", test: (e) => e.kind === "course" },
  { id: "active", label: "In progress", test: (e) => !e.finished && !e.want },
  { id: "done", label: "Finished", test: (e) => e.finished },
  { id: "want", label: "Want to read", test: (e) => e.want },
];

// ── Importing from AeroShelf ────────────────────────────────────────────────
const norm = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

/** A Tenax course with (nearly) the same title, if there is exactly one. */
function matchCourse(title, courses) {
  const t = norm(title);
  if (!t) return null;
  const exact = courses.filter(c => norm(c.name) === t);
  if (exact.length === 1) return exact[0];
  if (t.length < 6) return null;
  const close = courses.filter(c => {
    const n = norm(c.name);
    return n.length >= 6 && (n.includes(t) || t.includes(n));
  });
  return close.length === 1 ? close[0] : null;
}

/**
 * AeroShelf's items (its `as_items`) as shelf items. Items already on the shelf
 * (same title) are skipped; ones matching a Tenax course are linked to it.
 * Returns { items, linked: [{ title, course }], skipped }.
 */
export function fromAeroShelf(raw, state) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.as_items) ? raw.as_items : [];
  const courses = state.courses.filter(c => c.kind !== "notes");
  const ix = index(state);
  // Already on the shelf as an item of its own. (A Tenax course that's only on
  // the shelf automatically isn't: the AeroShelf item links to it instead.)
  const taken = new Set(state.shelf.map(it => norm(it.title || ix.course[it.courseId]?.name)));
  const linkedCourses = new Set(state.shelf.map(it => it.courseId).filter(Boolean));
  const items = [], linked = [];
  let skipped = 0;
  for (const a of list) {
    const title = String(a?.title || "").trim();
    if (!title || taken.has(norm(title))) { skipped++; continue; }
    taken.add(norm(title));
    const kind = a.kind === "course" ? "course" : "book";
    const total = Math.max(0, Math.floor(Number(a.total) || 0));
    const course = matchCourse(title, courses.filter(c => !linkedCourses.has(c.id)));
    if (course) { linkedCourses.add(course.id); linked.push({ title, course: course.name }); }
    items.push(makeShelfItem({
      kind, title, description: String(a.description || "").trim(),
      cover: typeof a.image === "string" && a.image.startsWith("data:image/") ? a.image : null,
      unitLabel: String(a.unitLabel || "").trim() || SHELF_KINDS[kind].unit,
      total, done: Math.max(0, Math.min(total, Math.floor(Number(a.done) || 0))),
      courseId: course?.id ?? null,
      createdAt: Number(a.createdAt) || Date.now(),
    }));
  }
  return { items, linked, skipped };
}
