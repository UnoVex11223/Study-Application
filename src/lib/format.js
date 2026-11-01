// How numbers, counts and dates read in the interface. One place for each, so
// "3 questions", "73%" and "Oct 31" look the same on every page.

/** "1 question", "1,012 answers"; pass the plural when it isn't just +s ("1 day is", "2 days are"). */
export const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString()} ${pluralWord(n, one, many)}`;

/** Just the word: pluralWord(1, "is", "are") → "is". */
export const pluralWord = (n, one, many = `${one}s`) => (n === 1 ? one : many);

/** A share as a whole percentage: 0.734 → "73%". */
export const pct = (x) => `${Math.round((x || 0) * 100)}%`;

const dateWith = (options) => (ts) => new Date(ts).toLocaleDateString(undefined, options);

/** Saturday, October 31 */
export const dayDate = dateWith({ weekday: "long", month: "long", day: "numeric" });
/** Oct 31 */
export const shortDate = dateWith({ month: "short", day: "numeric" });
/** Oct 31, 2026 */
export const longDate = dateWith({ month: "short", day: "numeric", year: "numeric" });
/** October 31, 2026 */
export const fullDate = dateWith({ month: "long", day: "numeric", year: "numeric" });
/** Oct 2026 */
export const monthYear = dateWith({ month: "short", year: "numeric" });
/** 7:45 PM */
export const clockTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
/** Oct 31, 7:45 PM */
export const dateTime = (ts) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
