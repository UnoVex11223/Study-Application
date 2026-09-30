// Reading: books you read for their own sake (not textbooks). Each book keeps
// a few notes in your own words (what it's about, what you thought, ideas
// worth keeping), and every so often Tenax asks you to recall it from memory
// before showing you those notes again. Recalls are spaced out further each
// time you remember a book well, so a finished book comes up a handful of
// times over the following year rather than every week.
//
// Deliberately simpler than concept scheduling: days, not minutes, and no AI.

import { uid } from "./model.js";

const DAY = 864e5;
export const FIRST_RECALL_DAYS = 3;
const MAX_DAYS = 365;

export const READING_STATUS = {
  reading: { label: "Reading" },
  finished: { label: "Finished" },
  want: { label: "Want to read" },
};

export const RECALL_RATINGS = [
  { rating: 1, label: "Forgot most of it" },
  { rating: 2, label: "Fuzzy" },
  { rating: 3, label: "Remembered it" },
  { rating: 4, label: "Easy" },
];

export const makeBook = (fields = {}) => ({
  id: uid("rb"), title: "", author: "", cover: null, status: "reading",
  currentPage: 0, totalPages: 0, rating: 0,
  about: "", thoughts: "", ideas: "",
  startedAt: null, finishedAt: null, recall: null, createdAt: Date.now(), ...fields,
});

export const hasNotes = (b) => Boolean((b.about || "").trim() || (b.thoughts || "").trim() || (b.ideas || "").trim());

/** The book with its fields changed; once it has notes, its first recall is scheduled. */
export function updateBook(book, patch, now = Date.now()) {
  const next = { ...book, ...patch };
  if (patch.status === "finished" && book.status !== "finished" && !patch.finishedAt) next.finishedAt = now;
  if (patch.status === "reading" && !book.startedAt && !patch.startedAt) next.startedAt = now;
  if (patch.status && patch.status !== "finished" && book.status === "finished") next.finishedAt = null;
  if (!next.recall && hasNotes(next)) next.recall = { due: now + FIRST_RECALL_DAYS * DAY, interval: FIRST_RECALL_DAYS, count: 0, history: [] };
  return next;
}

/** When to recall a book next, given how well you remembered it (1 forgot … 4 easy). */
export function nextRecall(recall, rating, now = Date.now()) {
  const prev = recall?.interval ?? FIRST_RECALL_DAYS;
  const days = rating <= 1 ? 2
    : rating === 2 ? Math.max(3, prev * 1.2)
      : rating === 3 ? Math.max(7, prev * 2.5)
        : Math.max(14, prev * 3.5);
  const interval = Math.min(MAX_DAYS, Math.round(days));
  return {
    due: now + interval * DAY,
    interval,
    count: (recall?.count ?? 0) + 1,
    history: [...(recall?.history ?? []), { ts: now, rating }].slice(-30),
  };
}

/** Books with notes whose recall is due, most overdue first. */
export function dueBooks(books, now = Date.now()) {
  return books.filter(b => hasNotes(b) && b.recall && b.recall.due <= now).sort((a, b) => a.recall.due - b.recall.due);
}

export function readingStats(books, now = Date.now()) {
  const year = new Date(now).getFullYear();
  return {
    reading: books.filter(b => b.status === "reading").length,
    finishedThisYear: books.filter(b => b.status === "finished" && b.finishedAt && new Date(b.finishedAt).getFullYear() === year).length,
    finished: books.filter(b => b.status === "finished").length,
    due: dueBooks(books, now).length,
  };
}

/** "in 12 days", "tomorrow", "today" */
export function recallWhen(recall, now = Date.now()) {
  if (!recall) return null;
  if (recall.due <= now) return "today";
  const days = Math.max(1, Math.round((recall.due - now) / DAY));
  if (days === 1) return "tomorrow";
  if (days < 60) return `in ${days} days`;
  const months = Math.round(days / 30);
  return `in ${months} months`;
}
