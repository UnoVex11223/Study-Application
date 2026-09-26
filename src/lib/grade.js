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

// ── Checking the AI grader's work ──────────────────────────────────────────
// A language model can occasionally mark a point as met when it isn't (for
// example, quoting the model answer instead of yours). These deterministic
// checks run on every AI grade and can only turn a "met" into "not met".

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000,
};
const NUM_RE = /(?<![\w)\]])[-\u2212\u2013]?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?/g; // a minus counts only when it isn't subtraction

/**
 * Numbers that carry meaning: two or more digits, negative, or decimal.
 * ("uses 2 pointers" doesn't require the digit 2; "-32,768" does.)
 */
export function significantNumbers(text) {
  const s = String(text || "").replace(/\b[a-z]+\b/gi, w => (w.toLowerCase() in NUMBER_WORDS ? String(NUMBER_WORDS[w.toLowerCase()]) : w));
  return (s.match(NUM_RE) || [])
    .map(n => n.replace(/[\u2212\u2013]/g, "-").replace(/,/g, ""))
    .map(n => n.replace(/\.0+$/, ""))
    .filter(n => n.startsWith("-") || n.includes(".") || n.replace("-", "").length >= 2);
}

/** Is the grader's quoted evidence really in the learner's answer? */
export function evidenceInAnswer(evidence, answer) {
  const e = normalize(evidence), a = normalize(answer);
  if (!e) return true; // nothing quoted, nothing to contradict
  if (a.includes(e)) return true;
  const ew = e.split(" ").filter(Boolean);
  const aw = new Set(a.split(" "));
  return ew.filter(w => aw.has(w)).length / ew.length >= 0.7;
}

/**
 * Downgrade AI-marked points that the answer can't support: required numbers
 * missing from the answer, or "evidence" that isn't in the answer at all.
 */
export function verifyPoints(points, answer) {
  const have = new Set(significantNumbers(answer));
  return points.map(p => {
    if (!p.met) return p;
    const missing = significantNumbers(p.text).filter(n => !have.has(n));
    if (missing.length) return { ...p, met: false, evidence: "", corrected: `Your answer doesn't contain ${missing.join(" and ")}.` };
    if (!evidenceInAnswer(p.evidence, answer)) return { ...p, met: false, evidence: "", corrected: "Your answer doesn't state this." };
    return p;
  });
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
