// Question quality gate.
//
// A question only reaches your reviews if it's worth years of repetitions, so
// every candidate goes through three filters:
//   1. Rules (this file, no AI): catches the mechanical failures — prompts that
//      contain their own answer, yes/no questions, "according to the chapter"
//      wording that won't make sense later, recall answers that are really
//      sentences, missing rubrics, near-duplicates.
//   2. Critic (AI, see electron.cjs): an independent review that scores each
//      question 1–5 on importance, clarity, retrieval, gradability and
//      accuracy, and keeps, rewrites or drops it. Only questions scoring 4+ on
//      every dimension pass.
//   3. Caps: at most 2 questions for a core concept (one to know the idea, one
//      to use it, when both pass) and 1 for a supporting or detail concept —
//      the best-scoring ones.
// After import, questions you report, miss 5+ times, or whose grading you
// dispute twice are pulled from sessions until you fix or restore them.

import { normalize } from "./grade.js";

export const PASS_SCORE = 4;
// Questions per concept. Memory is scheduled per concept and its questions take
// turns, so a second question on a core concept keeps you from memorizing one
// prompt's wording; beyond that, more questions mostly mean more to read
// through on import, so sections stay a manageable size.
export const QUESTION_CAP = { core: 2, supporting: 1, detail: 1 };

// With only a couple of slots, a core concept's pair should cover knowing the
// idea (recall, explain) and using it (distinguish, apply, connect).
const ABILITY_GROUP = { recall: "know", explain: "know", distinguish: "use", apply: "use", connect: "use" };
export const DIMENSIONS = {
  importance: "Worth remembering",
  clarity: "Clear on its own",
  retrieval: "Needs real recall",
  gradability: "Gradable",
  accuracy: "Accurate",
};

export const FLAG_REASONS = {
  unclear: "Unclear or ambiguous",
  wrong: "Model answer is wrong",
  trivial: "Not worth remembering",
  other: "Something else is off",
  leech: "Missed on 5 different days",
  disputed: "Grading overruled twice",
};
export const LEECH_LAPSES = 5;
export const DISPUTE_LIMIT = 2;

const STOP = new Set("the a an of to in on for and or is are was were be what which how why does do it its this that with as by from your you".split(" "));
const stripCode = (s) => String(s || "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " code ");
const words = (s) => normalize(stripCode(s)).split(" ").filter(Boolean);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const YES_NO = /^\s*(is|are|was|were|does|do|did|can|could|will|would|should|has|have|had)\b/i;
const OPEN = /\b(why|how|explain|describe|what happens|what would)\b/i;
const CONTEXT = /\b(according to (the|this) (text|author|book|chapter|passage|reading|section)|in (this|the) (chapter|section|passage|reading)|the author|as (mentioned|discussed|shown|described|noted) (above|earlier|previously|in the)|the (above|following|previous) (example|figure|table|listing|code)|(figure|fig\.|table|listing) \d)/i;
const LIST_ALL = /\b(list|name|enumerate|give) (all|every|each of the)\b/i;

/** Word-set similarity of two prompts (0–1), ignoring common words. */
export function similarity(a, b) {
  const A = new Set(words(a).filter(w => !STOP.has(w)));
  const B = new Set(words(b).filter(w => !STOP.has(w)));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Mechanical checks. `q` = { ability, prompt, answer, accept, points }.
 * Returns { ok, issues: [{ code, severity: "block" | "warn", message }] }.
 * `others` are questions already accepted, for duplicate detection.
 */
export function lintQuestion(q, { others = [] } = {}) {
  const issues = [];
  const add = (code, severity, message) => issues.push({ code, severity, message });
  const prompt = String(q.prompt || "");
  const answer = String(q.answer || "");
  const pw = words(prompt);
  const hasCode = /```/.test(prompt);

  if (!prompt.trim() || !answer.trim()) add("empty", "block", "Missing the question or its answer.");
  else if (pw.length < 4 && !hasCode) add("short", "block", "Too short to be clear on its own.");
  if (pw.length > 110) add("long", "warn", "Long question; it may be testing several things at once.");
  if (YES_NO.test(prompt) && !OPEN.test(prompt)) add("yes-no", "block", "Yes/no questions can be answered by guessing.");
  if (CONTEXT.test(prompt)) add("context", "block", "Refers to the book or an example you won't have in front of you later.");
  if (LIST_ALL.test(prompt)) add("list", "warn", "Asks for a complete list; long lists are hard to recall and to grade.");
  if ((prompt.match(/\?/g) || []).length > 2) add("multi", "warn", "Asks several questions at once.");

  if (q.ability === "recall") {
    const acc = (q.accept || []).map(a => String(a).trim()).filter(Boolean);
    if (!acc.length) add("no-accept", "block", "A recall question needs its accepted answers.");
    if (acc.some(a => words(a).length > 8)) add("recall-long", "block", "Recall answers should be a term or short fact, not a sentence.");
    const np = ` ${normalize(stripCode(prompt))} `;
    const leak = acc.find(a => {
      const n = normalize(a);
      return n.length >= 4 && new RegExp(`\\s${escapeRe(n)}\\s`).test(np);
    });
    if (leak) add("leak", "block", `The question contains its own answer ("${leak}").`);
    if (/^-?\d+([.,]\d+)?$/.test(normalize(answer))) add("number", "warn", "A bare number is usually trivia unless the number itself matters.");
  } else {
    const pts = (q.points || []).map(p => String(p).trim()).filter(Boolean);
    if (!pts.length) add("no-rubric", "block", "No key points to grade the answer against.");
    if (pts.length > 4) add("rubric-long", "warn", "More than four key points; the question may be too broad.");
    if (pts.some(p => words(p).length > 35)) add("rubric-vague", "warn", "A key point is long, which makes it hard to check.");
  }

  for (const o of others) {
    if (o !== q && similarity(prompt, o.prompt) >= 0.7) { add("duplicate", "block", "Nearly the same as another question."); break; }
  }
  return { ok: !issues.some(i => i.severity === "block"), issues };
}

const clampScore = (n) => Math.max(1, Math.min(5, Math.round(Number(n) || 0)));

/**
 * Decide the fate of one candidate given the critic's review (or null when the
 * critic wasn't available). Returns the question to keep (possibly the
 * critic's revision) plus a score and reasons.
 */
export function judge(candidate, review) {
  let q = candidate;
  let revised = false;
  const reasons = [];
  let dims = null;
  if (review) {
    dims = Object.fromEntries(Object.keys(DIMENSIONS).map(k => [k, clampScore(review.scores?.[k])]));
    if (review.verdict === "drop") return { keep: false, q, dims, score: avg(dims), revised, reasons: [review.reason || "Dropped by the quality review."] };
    if (review.verdict === "revise" && review.revision?.prompt?.trim()) {
      q = { ...candidate, ...pickRevision(review.revision) };
      revised = true;
    }
    const weak = Object.entries(dims).filter(([, v]) => v < PASS_SCORE);
    if (weak.length) {
      return {
        keep: false, q, dims, score: avg(dims), revised,
        reasons: [review.reason || `Scored low on ${weak.map(([k]) => DIMENSIONS[k].toLowerCase()).join(", ")}.`],
      };
    }
    if (review.reason) reasons.push(review.reason);
  }
  return { keep: true, q, dims, score: dims ? avg(dims) : null, revised, reasons };
}

function pickRevision(r) {
  const out = {};
  if (r.prompt?.trim()) out.prompt = r.prompt.trim();
  if (r.model_answer?.trim()) out.answer = r.model_answer.trim();
  if (Array.isArray(r.accept) && r.accept.length) out.accept = r.accept;
  if (Array.isArray(r.required_points) && r.required_points.length) out.points = r.required_points;
  if (Array.isArray(r.misconceptions)) out.misconceptions = r.misconceptions;
  if (typeof r.hint === "string") out.hint = r.hint;
  return out;
}

const avg = (dims) => {
  const v = Object.values(dims);
  return Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10;
};

/**
 * Run the whole gate for one concept's candidates.
 * candidates: [{ id, ability, prompt, answer, accept, points, misconceptions, hint }]
 * reviews: { [id]: review } from the critic, or {} if unavailable.
 * existing: questions the concept already has (topping up): they count toward
 * the cap, new ones mustn't duplicate them, and missing question types go first.
 * Returns { kept: [...], dropped: [...] } — each entry { ...question, id, score, dims, revised, reasons }.
 */
export function selectForConcept(candidates, reviews, importance = "supporting", { existing = [], extra = 0 } = {}) {
  const judged = candidates.map(c => ({ c, j: judge(c, reviews[c.id] ?? null) }));
  const dropped = [];
  const passing = [];
  for (const { c, j } of judged) {
    const entry = { ...j.q, id: c.id, score: j.score, dims: j.dims, revised: j.revised, reasons: j.reasons };
    if (!j.keep) dropped.push(entry);
    else passing.push(entry);
  }
  // Best first; unscored (critic unavailable) rank in the middle.
  passing.sort((a, b) => (b.score ?? 3.5) - (a.score ?? 3.5));

  const full = (QUESTION_CAP[importance] ?? 2) + extra;
  // An extra slot (a note's own example) is always available, even on a
  // concept that already has more than today's cap from an earlier version.
  const cap = Math.max(extra, full - existing.length);
  const kept = [];
  const tryAdd = (e) => {
    const lint = lintQuestion(e, { others: [...existing, ...kept] });
    if (!lint.ok) {
      dropped.push({ ...e, reasons: [lint.issues.find(i => i.severity === "block").message] });
      return false;
    }
    kept.push({ ...e, warnings: lint.issues.filter(i => i.severity === "warn").map(i => i.message) });
    return true;
  };
  // First pass: one to know the idea and one to use it. Second pass: other
  // question types the concept doesn't have yet. Then the best of the rest.
  const seenGroup = new Set(existing.map(q => ABILITY_GROUP[q.ability]));
  const seenAbility = new Set(existing.map(q => q.ability));
  let rest = [];
  for (const e of passing) {
    if (kept.length < cap && !seenGroup.has(ABILITY_GROUP[e.ability])) {
      if (tryAdd(e)) { seenGroup.add(ABILITY_GROUP[e.ability]); seenAbility.add(e.ability); }
    } else rest.push(e);
  }
  const later = [];
  for (const e of rest) {
    if (kept.length < cap && !seenAbility.has(e.ability)) {
      if (tryAdd(e)) seenAbility.add(e.ability);
    } else later.push(e);
  }
  rest = later;
  for (const e of rest) {
    if (kept.length >= cap) { dropped.push({ ...e, reasons: [`This ${importance} concept already has its ${full} best question${full === 1 ? "" : "s"}.`] }); continue; }
    tryAdd(e);
  }
  return { kept, dropped };
}
