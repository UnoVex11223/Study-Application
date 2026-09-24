// FSRS-4.5 spaced-repetition scheduler (the algorithm behind modern Anki).
// Pure functions — no React, no storage. All times are epoch ms; intervals in days.

// Published FSRS-4.5 default weights.
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031,
  1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];

const DECAY = -0.5;
const FACTOR = 19 / 81;
const REQUEST_RETENTION = 0.9;
const MAX_INTERVAL_DAYS = 36500;
const DAY_MS = 864e5;

// Learning steps in minutes before a card graduates to FSRS review intervals.
const LEARNING_STEPS_MIN = [1, 10];

export const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

export function newSrs() {
  return { state: "new", step: 0, stability: 0, difficulty: 0, due: null, lastReview: null, reps: 0, lapses: 0 };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const initStability = (rating) => Math.max(W[rating - 1], 0.1);
const initDifficulty = (rating) => clamp(W[4] - (rating - 3) * W[5], 1, 10);

function nextDifficulty(d, rating) {
  const next = d - W[6] * (rating - 3);
  return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * next, 1, 10);
}

const retrievability = (elapsedDays, stability) =>
  Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);

function nextRecallStability(d, s, r, rating) {
  const hardPenalty = rating === RATING.HARD ? W[15] : 1;
  const easyBonus = rating === RATING.EASY ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) *
    (Math.exp(W[10] * (1 - r)) - 1) * hardPenalty * easyBonus);
}

function nextForgetStability(d, s, r) {
  const sf = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
  return Math.min(sf, s);
}

function intervalDays(stability) {
  const ivl = (stability / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(ivl), 1, MAX_INTERVAL_DAYS);
}

// ±5% fuzz so cards learned together don't stay clumped forever.
function fuzz(days) {
  if (days < 3) return days;
  const delta = days * 0.05;
  return Math.max(1, Math.round(days + (Math.random() * 2 - 1) * delta));
}

const dueInMinutes = (now, min) => now + min * 60000;
const dueInDays = (now, days) => now + fuzz(days) * DAY_MS;

/**
 * Apply a rating to a card's srs state. Returns a NEW srs object.
 * @param {object} srs   current scheduling state (from newSrs())
 * @param {1|2|3|4} rating  Again / Hard / Good / Easy
 * @param {number} now   epoch ms
 */
export function rate(srs, rating, now = Date.now()) {
  const s = { ...srs, lastReview: now, reps: srs.reps + 1 };

  if (srs.state === "new") {
    s.difficulty = initDifficulty(rating);
    s.stability = initStability(rating);
    if (rating === RATING.EASY) {
      s.state = "review";
      s.due = dueInDays(now, intervalDays(s.stability));
    } else {
      s.state = "learning";
      s.step = rating === RATING.GOOD ? 1 : 0;
      s.due = dueInMinutes(now, rating === RATING.AGAIN ? LEARNING_STEPS_MIN[0] : rating === RATING.HARD ? 5 : LEARNING_STEPS_MIN[1]);
    }
    return s;
  }

  if (srs.state === "learning" || srs.state === "relearning") {
    if (rating === RATING.AGAIN) {
      s.step = 0;
      s.due = dueInMinutes(now, LEARNING_STEPS_MIN[0]);
    } else if (rating === RATING.HARD) {
      s.due = dueInMinutes(now, 5);
    } else if (rating === RATING.GOOD && s.step + 1 < LEARNING_STEPS_MIN.length) {
      s.step += 1;
      s.due = dueInMinutes(now, LEARNING_STEPS_MIN[s.step]);
    } else {
      // Graduate (Good past last step, or Easy).
      if (rating === RATING.EASY) s.stability = nextRecallStability(s.difficulty, s.stability, 1, RATING.EASY);
      s.state = "review";
      s.step = 0;
      s.due = dueInDays(now, intervalDays(s.stability));
    }
    return s;
  }

  // Review state.
  const elapsed = Math.max((now - (srs.lastReview ?? now)) / DAY_MS, 0);
  const r = retrievability(elapsed, srs.stability);
  s.difficulty = nextDifficulty(srs.difficulty, rating);
  if (rating === RATING.AGAIN) {
    s.lapses = srs.lapses + 1;
    s.stability = Math.max(nextForgetStability(s.difficulty, srs.stability, r), 0.1);
    s.state = "relearning";
    s.step = 0;
    s.due = dueInMinutes(now, LEARNING_STEPS_MIN[0]);
  } else {
    s.stability = nextRecallStability(s.difficulty, srs.stability, r, rating);
    s.due = dueInDays(now, intervalDays(s.stability));
  }
  return s;
}

/** Human label for what each rating would schedule, e.g. "3d" / "10m". */
export function previewIntervals(srs, now = Date.now()) {
  const label = (due) => {
    const mins = Math.round((due - now) / 60000);
    if (mins < 60) return `${Math.max(mins, 1)}m`;
    const days = Math.round((due - now) / DAY_MS);
    if (days < 1) return `${Math.round(mins / 60)}h`;
    if (days < 31) return `${days}d`;
    if (days < 365) return `${Math.round(days / 30.4)}mo`;
    return `${(days / 365).toFixed(1)}y`;
  };
  const out = {};
  for (const rt of [1, 2, 3, 4]) out[rt] = label(rate(srs, rt, now).due);
  return out;
}

/** All cards due for review across topics, interleaved, plus new cards up to the daily allowance. */
export function getDueCards(topics, { now = Date.now(), newAllowance = 20 } = {}) {
  const due = [];
  const fresh = [];
  for (const t of topics) {
    for (const c of t.cards) {
      const item = { ...c, topicId: t.id, topicName: t.name };
      if (!c.srs || c.srs.state === "new") fresh.push(item);
      else if (c.srs.due != null && c.srs.due <= now) due.push(item);
    }
  }
  const shuffled = due.sort(() => Math.random() - 0.5);
  const newCards = fresh.sort(() => Math.random() - 0.5).slice(0, Math.max(newAllowance, 0));
  return [...shuffled, ...newCards];
}

/** Count of due (non-new) cards, e.g. for badges. */
export function dueCount(cards, now = Date.now()) {
  return cards.filter(c => c.srs && c.srs.state !== "new" && c.srs.due != null && c.srs.due <= now).length;
}

/** Cards scheduled per day for the next `days` days (index 0 = today, incl. overdue). */
export function dueForecast(topics, days = 7, now = Date.now()) {
  const counts = new Array(days).fill(0);
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  for (const t of topics) {
    for (const c of t.cards) {
      if (!c.srs || c.srs.state === "new" || c.srs.due == null) continue;
      const idx = Math.floor((c.srs.due - startOfToday.getTime()) / DAY_MS);
      if (idx < 0) counts[0] += 1;
      else if (idx < days) counts[idx] += 1;
    }
  }
  return counts;
}

/** Scheduling maturity only; this is not evidence of whole-subject mastery. */
export const isMature = (c) => c.srs?.state === "review" && c.srs.stability >= 21;
