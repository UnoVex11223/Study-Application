// Recall for the books you read: a few notes in your own words (what it's
// about, what you thought, ideas worth keeping), and every so often Tenax asks
// what you remember before showing you those notes again. Recalls are spaced
// out further each time you remember well, so a finished book comes up a
// handful of times over the following year rather than every week.
//
// Deliberately simpler than concept scheduling: days, not minutes, and no AI.

const DAY = 864e5;
export const FIRST_RECALL_DAYS = 3;
const MAX_DAYS = 365;

export const RECALL_RATINGS = [
  { rating: 1, label: "Forgot most of it" },
  { rating: 2, label: "Fuzzy" },
  { rating: 3, label: "Remembered it" },
  { rating: 4, label: "Easy" },
];

/** Notes on a shelf item: "what it's about" is its description. */
export const hasNotes = (it) => Boolean((it.description || "").trim() || (it.thoughts || "").trim() || (it.ideas || "").trim());

export const firstRecall = (now) => ({ due: now + FIRST_RECALL_DAYS * DAY, interval: FIRST_RECALL_DAYS, count: 0, history: [] });

/** When to recall something next, given how well you remembered it (1 forgot … 4 easy). */
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

/** Reading books to recall now (with notes, not linked to a Tenax course), most overdue first. */
export function dueForRecall(items, now = Date.now()) {
  return items
    .filter(it => it.kind === "reading" && !it.courseId && !it.hidden && hasNotes(it) && it.recall && it.recall.due <= now)
    .sort((a, b) => a.recall.due - b.recall.due);
}

/** "in 12 days", "tomorrow", "today" */
export function recallWhen(recall, now = Date.now()) {
  if (!recall) return null;
  if (recall.due <= now) return "today";
  const days = Math.max(1, Math.round((recall.due - now) / DAY));
  if (days === 1) return "tomorrow";
  if (days < 60) return `in ${days} days`;
  return `in ${Math.round(days / 30)} months`;
}
