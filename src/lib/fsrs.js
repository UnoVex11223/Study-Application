// FSRS-6 spaced-repetition scheduler (the current version of the algorithm
// behind Anki's scheduler; formulas and default parameters from
// open-spaced-repetition's reference implementation, py-fsrs).
// Pure functions — no React, no storage. Times are epoch ms; intervals in days.
//
// What FSRS-6 adds over the FSRS-4.5 this app used before:
//  - a forgetting curve whose shape is a parameter (w20), fitted on far more
//    review data, so recall chances are better calibrated;
//  - same-day reviews (learning steps, a relearn after a miss, a second look
//    on the same day) change memory stability instead of being ignored;
//  - difficulty moves less as it nears its maximum (linear damping);
//  - a lapse never leaves stability higher than a same-day miss would.
// Schedules saved by FSRS-4.5 carry over as they are: both scale stability so
// that recall is 90% after S days, so due dates don't move.
//
// Additions over plain FSRS:
//  - configurable target retention
//  - load balancing: when a review lands 3+ days out, the exact day is picked
//    inside the fuzz window to whichever day has the fewest reviews already
//    scheduled, which keeps future days even instead of spiky.

const W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];

const DECAY = -W[20];
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1; // recall is 90% when elapsed days = stability
const S_MIN = 0.001;
const MAX_INTERVAL_DAYS = 36500;
const DAY_MS = 864e5;
const LEARNING_STEPS_MIN = [1, 10];

export const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };
export const RATING_LABEL = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

export function newSrs() {
  return { state: "new", step: 0, stability: 0, difficulty: 0, due: null, lastReview: null, reps: 0, lapses: 0 };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const initStability = (rating) => Math.max(W[rating - 1], S_MIN);
const rawInitDifficulty = (rating) => W[4] - Math.exp(W[5] * (rating - 1)) + 1;
const initDifficulty = (rating) => clamp(rawInitDifficulty(rating), 1, 10);

/** Difficulty after a rating: a step towards harder or easier, damped near 10, pulled gently back towards the default. */
function nextDifficulty(d, rating) {
  const delta = -W[6] * (rating - 3);
  const damped = d + delta * (10 - d) / 9;
  return clamp(W[7] * rawInitDifficulty(RATING.EASY) + (1 - W[7]) * damped, 1, 10);
}

const forgettingCurve = (elapsedDays, stability) =>
  Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);

/** Probability (0–1) the item is recalled right now. Null for unseen items. */
export function retrievability(srs, now = Date.now()) {
  if (!srs || srs.state === "new" || !srs.lastReview || !srs.stability) return null;
  const elapsed = Math.max((now - srs.lastReview) / DAY_MS, 0);
  return forgettingCurve(elapsed, srs.stability);
}

function nextRecallStability(d, s, r, rating) {
  const hardPenalty = rating === RATING.HARD ? W[15] : 1;
  const easyBonus = rating === RATING.EASY ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) *
    (Math.exp(W[10] * (1 - r)) - 1) * hardPenalty * easyBonus);
}

function nextForgetStability(d, s, r) {
  const longTerm = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
  const shortTerm = s / Math.exp(W[17] * W[18]);
  return Math.min(longTerm, shortTerm);
}

/** Stability after a review on the same day as the last one (learning steps, relearning, a second look). */
function shortTermStability(s, rating) {
  let inc = Math.exp(W[17] * (rating - 3 + W[18])) * Math.pow(s, -W[19]);
  if (rating >= RATING.HARD) inc = Math.max(inc, 1);
  return s * inc;
}

export function intervalDays(stability, retention = 0.9) {
  const ivl = (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(ivl), 1, MAX_INTERVAL_DAYS);
}

/**
 * Pick the due date for an interval. Short intervals are exact; longer ones
 * get a ±5% window and land on the least-loaded day inside it.
 */
function scheduleDays(now, days, { loadAt, random = Math.random } = {}) {
  if (days < 3) return now + days * DAY_MS;
  const delta = Math.max(1, Math.round(days * 0.05));
  const lo = Math.max(1, days - delta), hi = days + delta;
  if (!loadAt) return now + (lo + Math.floor(random() * (hi - lo + 1))) * DAY_MS;
  let best = [], bestLoad = Infinity;
  for (let d = lo; d <= hi; d++) {
    const load = loadAt(now + d * DAY_MS);
    if (load < bestLoad) { bestLoad = load; best = [d]; }
    else if (load === bestLoad) best.push(d);
  }
  return now + best[Math.floor(random() * best.length)] * DAY_MS;
}

const inMinutes = (now, min) => now + min * 60000;

/** New stability and difficulty for a review of a card that isn't new. */
function remember(base, rating, now) {
  const elapsed = Math.max((now - (base.lastReview ?? now)) / DAY_MS, 0);
  const s0 = Math.max(base.stability || S_MIN, S_MIN);
  const d0 = base.difficulty || initDifficulty(RATING.GOOD);
  let stability;
  if (elapsed < 1) stability = shortTermStability(s0, rating);
  else {
    const r = forgettingCurve(elapsed, s0);
    stability = rating === RATING.AGAIN ? nextForgetStability(d0, s0, r) : nextRecallStability(d0, s0, r, rating);
  }
  return { stability: Math.max(stability, S_MIN), difficulty: nextDifficulty(d0, rating) };
}

/**
 * Apply a rating to an item's scheduling state. Returns a NEW srs object.
 * @param {object} srs      current state (from newSrs())
 * @param {1|2|3|4} rating  Again / Hard / Good / Easy
 * @param {number} now      epoch ms
 * @param {{retention?: number, loadAt?: (ts:number)=>number, random?: ()=>number}} opts
 */
export function rate(srs, rating, now = Date.now(), opts = {}) {
  const retention = opts.retention ?? 0.9;
  const base = srs ?? newSrs();
  const s = { ...base, lastReview: now, reps: base.reps + 1 };

  if (base.state === "new") {
    s.difficulty = initDifficulty(rating);
    s.stability = initStability(rating);
    if (rating === RATING.EASY) {
      s.state = "review";
      s.due = scheduleDays(now, intervalDays(s.stability, retention), opts);
    } else {
      s.state = "learning";
      s.step = rating === RATING.GOOD ? 1 : 0;
      s.due = inMinutes(now, rating === RATING.AGAIN ? LEARNING_STEPS_MIN[0] : rating === RATING.HARD ? 5 : LEARNING_STEPS_MIN[1]);
    }
    return s;
  }

  Object.assign(s, remember(base, rating, now));

  if (base.state === "learning" || base.state === "relearning") {
    if (rating === RATING.AGAIN) {
      s.step = 0;
      s.due = inMinutes(now, LEARNING_STEPS_MIN[0]);
    } else if (rating === RATING.HARD) {
      s.due = inMinutes(now, 5);
    } else if (rating === RATING.GOOD && s.step + 1 < LEARNING_STEPS_MIN.length) {
      s.step += 1;
      s.due = inMinutes(now, LEARNING_STEPS_MIN[s.step]);
    } else {
      s.state = "review";
      s.step = 0;
      s.due = scheduleDays(now, intervalDays(s.stability, retention), opts);
    }
    return s;
  }

  if (rating === RATING.AGAIN) {
    s.lapses = base.lapses + 1;
    s.state = "relearning";
    s.step = 0;
    s.due = inMinutes(now, LEARNING_STEPS_MIN[0]);
  } else {
    s.due = scheduleDays(now, intervalDays(s.stability, retention), opts);
  }
  return s;
}

export function formatInterval(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  const days = Math.round(ms / DAY_MS);
  if (days < 1) return `${Math.round(mins / 60)}h`;
  if (days < 31) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30.4)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** Label for what each rating would schedule, e.g. { 1: "1m", 3: "4d" }. */
export function previewIntervals(srs, now = Date.now(), opts = {}) {
  const out = {};
  const fixed = { ...opts, loadAt: undefined, random: () => 0.5 };
  for (const rt of [1, 2, 3, 4]) out[rt] = formatInterval(rate(srs, rt, now, fixed).due - now);
  return out;
}
