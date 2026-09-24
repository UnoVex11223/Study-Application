// Persistence + data migration. Talks to electron-store through the preload
// bridge (async IPC). Falls back to in-memory when running outside Electron.

import { newSrs } from "./fsrs.js";

const memory = {};

const bridge = () => (typeof window !== "undefined" && window.aeroflash?.store) || null;

export async function storeGet(key) {
  const b = bridge();
  if (!b) return memory[key] ?? null;
  try { return await b.get(key); } catch { return null; }
}

export function storeSet(key, val) {
  const b = bridge();
  if (!b) { memory[key] = val; return; }
  b.set(key, val).catch(() => {});
}

export const todayStr = (d = new Date()) => d.toISOString().slice(0, 10);

const SCHEMA_VERSION = 2;

const DEFAULT_STATS = {
  streak: 0, lastStudyDate: null, todayCount: 0, lastSim: null,
  newCardsDate: null, newCardsToday: 0,
};

const DEFAULT_LOG = { entries: [], daily: {} };

// v1 → v2: give every card a type and an FSRS scheduling block. Cards the user
// was getting wrong under the old binary system land due immediately.
function migrateTopics(topics) {
  return (topics || []).map(t => ({
    ...t,
    cards: (t.cards || []).map(c => {
      if (c.srs) return c;
      const srs = newSrs();
      const misses = (c.wrongAt || []).length;
      if (misses > 0) {
        Object.assign(srs, {
          state: "relearning", step: 0, stability: 0.5, difficulty: 7,
          due: Date.now(), reps: misses, lapses: misses,
        });
      }
      return { type: "basic", ...c, srs };
    }),
  }));
}

/** Load everything the app needs at boot, migrating old data if present. */
export async function loadAll() {
  const [topicsRaw, xp, statsRaw, logRaw, version] = await Promise.all([
    storeGet("af_topics"), storeGet("af_xp"), storeGet("af_stats"),
    storeGet("af_log"), storeGet("af_schema_version"),
  ]);
  let topics = topicsRaw ?? [];
  if ((version ?? 1) < SCHEMA_VERSION) {
    topics = migrateTopics(topics);
    storeSet("af_topics", topics);
    storeSet("af_schema_version", SCHEMA_VERSION);
  }
  return {
    topics,
    xp: xp ?? 0,
    stats: { ...DEFAULT_STATS, ...(statsRaw ?? {}) },
    log: logRaw ?? DEFAULT_LOG,
  };
}

export const saveTopics = (topics) => storeSet("af_topics", topics);
export const saveXp = (xp) => storeSet("af_xp", xp);
export const saveStats = (stats) => storeSet("af_stats", stats);
export const saveLog = (log) => storeSet("af_log", log);

/** Bump streak / today counters after n reviews. Returns the new stats object. */
export function bumpStats(stats, n = 1) {
  const today = todayStr();
  const yesterday = todayStr(new Date(Date.now() - 864e5));
  const ns = {
    ...stats,
    streak: stats.lastStudyDate === today ? stats.streak : stats.lastStudyDate === yesterday ? stats.streak + 1 : 1,
    lastStudyDate: today,
    todayCount: (stats.lastStudyDate === today ? stats.todayCount : 0) + n,
  };
  saveStats(ns);
  return ns;
}

/** How many brand-new cards may still be introduced today (cap 20/day). */
export function newAllowance(stats, cap = 20) {
  return stats.newCardsDate === todayStr() ? Math.max(cap - stats.newCardsToday, 0) : cap;
}

export function bumpNewCards(stats, n = 1) {
  const today = todayStr();
  const ns = {
    ...stats,
    newCardsDate: today,
    newCardsToday: (stats.newCardsDate === today ? stats.newCardsToday : 0) + n,
  };
  saveStats(ns);
  return ns;
}

const MAX_LOG_ENTRIES = 5000;

/** Append one review to the log (raw entry + daily rollup). Returns the new log. */
export function logReview(log, { cardId, topicId, rating, mode }, now = Date.now()) {
  const date = todayStr(new Date(now));
  const day = log.daily[date] ?? { reviews: 0, correct: 0 };
  const ns = {
    entries: [...log.entries, { ts: now, cardId, topicId, rating, mode }].slice(-MAX_LOG_ENTRIES),
    daily: { ...log.daily, [date]: { ...day, reviews: day.reviews + 1,
      ratedReviews: (day.ratedReviews ?? day.reviews) + 1,
      correct: day.correct + (rating >= 3 ? 1 : 0) } },
  };
  return ns;
}

/** Retention = share of reviews rated Good/Easy over the last `days` days. */
export function retention(log, days = 30, now = Date.now()) {
  const cutoff = now - days * 864e5;
  let total = 0, good = 0;
  for (const [date, d] of Object.entries(log.daily)) {
    if (new Date(date + "T00:00:00").getTime() >= cutoff) { total += d.ratedReviews ?? d.reviews; good += d.correct; }
  }
  return total === 0 ? null : good / total;
}

export const getApiKeySet = async () => Boolean(await storeGet("af_api_key"));
export const setApiKey = (key) => storeSet("af_api_key", key || null);

/** Wipe topics/cards/XP/stats/review history. Leaves the API key untouched. */
export function resetProgress() {
  storeSet("af_topics", null);
  storeSet("af_xp", null);
  storeSet("af_stats", null);
  storeSet("af_log", null);
  storeSet("af_schema_version", null);
  return { topics: [], xp: 0, stats: { ...DEFAULT_STATS }, log: { ...DEFAULT_LOG } };
}
