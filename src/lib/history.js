// Small histories for the sparklines next to numbers: what happened on each
// of the last few study days. Day keys ("2026-10-10") sort as strings.

import { addDays } from "./time.js";
import { index } from "./model.js";
import { isEvidence, conceptMastery } from "./mastery.js";

/** The last n day keys, oldest first, ending with today. */
export const lastDays = (today, n) => Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));

/** How many of these attempts (that pass the test) fall on each day. */
export function perDay(attempts, days, test = () => true) {
  const at = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const a of attempts) {
    const i = at.get(a.day);
    if (i != null && test(a)) out[i]++;
  }
  return out;
}

/** A running total: how many of these events happened on or before each day. */
export function runningTotal(eventDays, days) {
  const sorted = eventDays.filter(Boolean).slice().sort();
  let j = 0;
  return days.map(d => {
    while (j < sorted.length && sorted[j] <= d) j++;
    return j;
  });
}

/**
 * When each concept was started (the day of its first answer) and, for the
 * ones mastered now, the day they got there (the second day with an unaided
 * correct answer, which is when the rule can first be met).
 */
export function milestones(state, concepts, now = Date.now()) {
  const ix = index(state);
  const started = [], mastered = [];
  for (const c of concepts) {
    const atts = ix.attemptsByConcept[c.id] || [];
    if (!atts.length) continue;
    started.push(atts.reduce((m, a) => (a.day < m ? a.day : m), atts[0].day));
    if (conceptMastery(state, c.id, now).status !== "mastered") continue;
    const days = [...new Set(atts.filter(isEvidence).map(a => a.day))].sort();
    if (days.length >= 2) mastered.push(days[1]);
  }
  return { started, mastered };
}

/** Points for a sparkline of these values in a w×h box, with a little room at the edges. */
export function sparkPoints(values, w, h, pad = 2) {
  if (!values.length) return [];
  const max = Math.max(...values), min = Math.min(0, ...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => [pad + i * step, h - pad - ((v - min) / span) * (h - pad * 2)]);
}
