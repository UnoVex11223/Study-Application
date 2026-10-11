// Mastery model. Three separate questions, never blended into one number:
//   coverage  — how much of the material has been introduced
//   mastery   — which concepts meet explicit evidence requirements
//   memory    — how likely you are to recall them right now (FSRS estimate)
//
// A concept counts as MASTERED when all of these hold:
//   • answered correctly without hints on at least 2 different days
//   • the two most recent study days with this concept both ended in a
//     correct, unaided answer (so the most recent attempt was correct)
//   • if it has an application-type task (apply / distinguish / connect),
//     at least one of those was answered correctly without help
// Aided answers (hint used or answer revealed) never count.

import { index, IMPORTANCE, ABILITY_KEYS } from "./model.js";
import { retrievability } from "./fsrs.js";

const EVIDENCE_MODES = new Set(["review", "session", "practice", "teachback"]);
export const TRANSFER = new Set(["apply", "distinguish", "connect"]);

export const isEvidence = (a) => a.verdict === "correct" && !a.aided && EVIDENCE_MODES.has(a.mode);

export const STATUS = {
  new:       { label: "Not started", rank: 0 },
  learning:  { label: "Learning",    rank: 1 },
  slipping:  { label: "Slipping",    rank: 1 },
  practiced: { label: "Practiced",   rank: 2 },
  mastered:  { label: "Mastered",    rank: 3 },
};

/**
 * What the rules above make of a concept's answers: its status, and the
 * evidence behind it. Shared by conceptMastery and the map's time-lapse (which
 * replays the answers up to each day).
 */
export function statusFrom(attempts, { started = attempts.length > 0, hasTransferItem = false } = {}) {
  const graded = attempts.filter(a => a.verdict !== "ungraded");
  const evidence = graded.filter(isEvidence);
  const days = new Set(evidence.map(a => a.day));
  const last = graded.reduce((m, a) => (!m || a.ts > m.ts ? a : m), null);
  const lastOk = Boolean(last && last.verdict === "correct" && !last.aided);
  // How each of the two most recent study days ended — mastery needs both to
  // end in an unaided correct answer, so one lucky day after many misses isn't enough.
  const dayEnd = {};
  for (const a of graded) if (!dayEnd[a.day] || a.ts > dayEnd[a.day].ts) dayEnd[a.day] = a;
  const recentDays = Object.keys(dayEnd).sort().slice(-2);
  const recentOk = recentDays.length === 2 && recentDays.every(d => dayEnd[d].verdict === "correct" && !dayEnd[d].aided);
  const transferOk = evidence.some(a => TRANSFER.has(a.ability));

  let status;
  if (!started) status = "new";
  else if (last && last.verdict !== "correct" && days.size >= 1) status = "slipping";
  else if (days.size >= 2 && lastOk && recentOk && (!hasTransferItem || transferOk)) status = "mastered";
  else if (days.size >= 1) status = "practiced";
  else status = "learning";
  return { status, days, last, lastOk, recentOk, transferOk };
}

/** Detailed evidence for one concept. */
export function conceptMastery(state, conceptId, now = Date.now()) {
  const ix = index(state);
  const items = (ix.itemsByConcept[conceptId] || []).filter(i => !i.flag);
  const attempts = ix.attemptsByConcept[conceptId] || [];
  const hasTransferItem = items.some(i => TRANSFER.has(i.ability));

  const srs = ix.concept[conceptId]?.srs;
  const memory = retrievability(srs, now);
  const lapses = srs?.lapses || 0;
  const scheduled = Boolean(srs && srs.state !== "new");
  const started = scheduled || attempts.length > 0;
  const { status, days, last, lastOk, recentOk, transferOk } = statusFrom(attempts, { started, hasTransferItem });

  const due = scheduled && srs.due != null && srs.due <= now;
  return {
    status, memory, lapses, due, started,
    correctDays: days.size, needsTransfer: hasTransferItem && !transferOk, recentOk,
    lastVerdict: last ? (lastOk ? "correct" : last.verdict === "correct" ? "aided" : last.verdict) : null,
    lastTs: last?.ts ?? null,
  };
}

/** Human explanation of a concept's status, listing what's still missing. */
export function explainMastery(m) {
  if (m.status === "new") return "Not introduced yet. It will appear in a daily session when its prerequisites are in place.";
  if (m.status === "mastered") return `Mastered: answered correctly without help on ${m.correctDays} different days${m.needsTransfer ? "" : ", including applying it"}.`;
  const missing = [];
  if (m.correctDays < 2) missing.push(`${2 - m.correctDays} more day${2 - m.correctDays === 1 ? "" : "s"} with a correct unaided answer`);
  if (m.needsTransfer) missing.push("a correct answer on an application question");
  if (m.lastVerdict && m.lastVerdict !== "correct") missing.push("a correct answer on the next attempt");
  else if (m.correctDays >= 2 && !m.recentOk) missing.push("correct answers on two study days in a row");
  const head = m.status === "slipping" ? "Slipping: the last attempt was missed." : "In progress.";
  return missing.length ? `${head} Still needed: ${missing.join("; ")}.` : head;
}

/** Aggregate mastery over a set of concepts. Denominator is core concepts when any exist. */
export function aggregate(state, concepts, now = Date.now()) {
  const active = concepts.filter(c => !c.suspended);
  const core = active.filter(c => c.importance === "core");
  const basis = core.length ? core : active;
  let mastered = 0, introduced = 0, memSum = 0, memN = 0, slipping = 0, due = 0;
  const per = {};
  for (const c of active) {
    const m = conceptMastery(state, c.id, now);
    per[c.id] = m;
    if (m.started) introduced++;
    if (m.status === "slipping") slipping++;
    if (m.due) due++;
    if (m.memory != null) { memSum += m.memory; memN++; }
  }
  for (const c of basis) if (per[c.id].status === "mastered") mastered++;
  return {
    total: active.length, basisCount: basis.length, basisIsCore: core.length > 0,
    mastered, masteryPct: basis.length ? mastered / basis.length : 0,
    introduced, coveragePct: active.length ? introduced / active.length : 0,
    memory: memN ? memSum / memN : null, slipping, due, per,
  };
}

/** Course totals count only chapters you've unlocked; `locked` says how many concepts wait in locked ones. */
export function courseMastery(state, courseId, now = Date.now()) {
  const ix = index(state);
  const all = ix.conceptsByCourse[courseId] || [];
  const open = all.filter(c => !ix.lockedConcepts.has(c.id));
  return { ...aggregate(state, open, now), locked: all.length - open.length };
}

export function sectionMastery(state, sectionId, now = Date.now()) {
  return aggregate(state, index(state).conceptsBySection[sectionId] || [], now);
}

/** Success rate per ability over recent unaided attempts. */
export function abilityBreakdown(state, { courseId = null, days = 60, now = Date.now() } = {}) {
  const cutoff = now - days * 864e5;
  const out = Object.fromEntries(ABILITY_KEYS.map(k => [k, { attempts: 0, correct: 0 }]));
  for (const a of state.attempts) {
    if (a.ts < cutoff || a.aided || a.verdict === "ungraded") continue;
    if (courseId && a.courseId !== courseId) continue;
    const o = out[a.ability];
    if (!o) continue;
    o.attempts++;
    if (a.verdict === "correct") o.correct++;
  }
  return out;
}

export const importanceWeight = (c) => IMPORTANCE[c.importance]?.weight ?? 0.75;
