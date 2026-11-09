// Small histories for the sparklines next to numbers: what happened on each
// of the last few study days. Day keys ("2026-10-10") sort as strings.

import { addDays } from "./time.js";
import { index } from "./model.js";
import { conceptMastery } from "./mastery.js";

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
 * ones mastered now, the day they got there (the mastery test they passed).
 */
export function milestones(state, concepts, now = Date.now()) {
  const ix = index(state);
  const started = [], mastered = [];
  for (const c of concepts) {
    const atts = ix.attemptsByConcept[c.id] || [];
    if (!atts.length) continue;
    started.push(atts.reduce((m, a) => (a.day < m ? a.day : m), atts[0].day));
    const m = conceptMastery(state, c.id, now);
    if (m.status !== "mastered") continue;
    const passed = atts.find(a => a.ts === m.passedAt);
    if (passed) mastered.push(passed.day);
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

/** Your current streak (counting today once you have answered something, yesterday until then), your best, and how many days you have studied. */
export function streaks(counts, today) {
  const days = Object.keys(counts).filter(k => counts[k] > 0).sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let current = 0;
  for (let d = counts[today] ? today : addDays(today, -1); counts[d] > 0; d = addDays(d, -1)) current++;
  return { current, best, days: days.length };
}
