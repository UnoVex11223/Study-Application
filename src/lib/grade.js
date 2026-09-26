// Grading helpers that don't need AI: exact-answer matching for recall tasks,
// turning rubric checks into a verdict, and verdict → FSRS rating.

import { RATING } from "./fsrs.js";

const ARTICLES = /\b(a|an|the)\b/g;

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[`"'“”‘’.,;:!?()[\]{}]/g, " ")
    .replace(ARTICLES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Does a short answer match one of the accepted answers?
 * Exact after normalization, or a small typo on longer answers.
 * Only used as a fast path for short recall answers; anything longer goes to
 * the rubric (AI or self-check).
 */
export function matchesAccepted(answer, accepted = []) {
  const a = normalize(answer);
  if (!a) return false;
  for (const acc of accepted) {
    const b = normalize(acc);
    if (!b) continue;
    if (a === b) return true;
    const tolerance = b.length >= 12 ? 2 : b.length >= 6 ? 1 : 0;
    if (tolerance && levenshtein(a, b) <= tolerance) return true;
  }
  return false;
}

/**
 * Verdict from rubric checks. All required points met and no misconception →
 * correct. Some met with no misconception → partial. Otherwise incorrect.
 */
export function verdictFromChecks(pointsMet, misconceptionCount = 0) {
  const total = pointsMet.length;
  const met = pointsMet.filter(Boolean).length;
  if (total === 0) return misconceptionCount ? "incorrect" : "correct";
  if (met === total && misconceptionCount === 0) return "correct";
  if (met > 0 && misconceptionCount === 0) return "partial";
  return "incorrect";
}

export const VERDICT = {
  correct:   { label: "Correct",      tone: "good" },
  partial:   { label: "Partly there", tone: "warn" },
  incorrect: { label: "Not yet",      tone: "bad" },
  ungraded:  { label: "Ungraded",     tone: "muted" },
};

/** Suggested FSRS rating. Help (hints, reveals) caps the rating at Hard. */
export function suggestedRating(verdict, { aided = false } = {}) {
  if (verdict === "correct") return aided ? RATING.HARD : RATING.GOOD;
  if (verdict === "partial") return RATING.HARD;
  return RATING.AGAIN;
}
