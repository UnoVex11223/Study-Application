// XP and ranks. XP comes from your answers (nothing extra is stored), so it
// syncs with them and counts everything you've done since you started:
//   right, without help    10
//   partly right            5
//   right in a mastery test 50 (it masters the concept)
//
// Ranks are kyu and dan, as in judo or go: you start at 10th kyu and count
// down to 1st kyu, then up through the dan grades, 1st dan, 2nd dan, … with
// no top. Rank r (0 = 10th kyu) starts at 100·r² XP, so each step takes a
// little longer than the last (7th kyu at 900, 1st kyu at 8,100, 1st dan at
// 10,000, 10th dan at 36,100) and there is always a next one.
//
// Weeks start again every Monday: your XP this week against your best week
// is the thing to beat, again and again.

import { keyToDate, addDays } from "./time.js";

export const XP = { right: 10, partly: 5, test: 50 };
export const KYU = 10; // kyu grades before the first dan

/** XP for one answer: { verdict, aided, mode }. */
export function xpFor(a) {
  if (!a || a.aided || a.mode === "pretest") return 0;
  if (a.mode === "test") return a.verdict === "correct" ? XP.test : 0;
  if (a.verdict === "correct") return XP.right;
  if (a.verdict === "partial") return XP.partly;
  return 0;
}

export const totalXp = (attempts = []) => attempts.reduce((n, a) => n + xpFor(a), 0);

const ordinal = (n) => {
  const t = n % 100;
  return `${n}${t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
};

/** The name of rank r: 0 → "10th kyu", 9 → "1st kyu", 10 → "1st dan", 11 → "2nd dan", … */
export const rankName = (r) => (r < KYU ? `${ordinal(KYU - r)} kyu` : `${ordinal(r - KYU + 1)} dan`);

/** XP at which rank r starts. */
export const rankStart = (r) => 100 * r * r;

/** Where an XP total stands: { index, name, next, xp, from, to, progress (0–1), toGo, dan }. */
export function rankFor(xp) {
  const total = Math.max(0, Math.floor(xp || 0));
  const index = Math.floor(Math.sqrt(total / 100));
  const from = rankStart(index), to = rankStart(index + 1);
  return { index, name: rankName(index), next: rankName(index + 1), xp: total, from, to, progress: (total - from) / (to - from), toGo: to - total, dan: index >= KYU };
}

/** The Monday a day key's week starts on, as a day key. */
export function weekOf(day) {
  const back = (keyToDate(day).getDay() + 6) % 7; // Monday 0 … Sunday 6
  return addDays(day, -back);
}

/** XP this week (from Monday) and in your best week so far, this one included: { thisWeek, best, bestBefore }. */
export function weeklyXp(attempts = [], today) {
  const byWeek = new Map();
  for (const a of attempts) {
    const x = xpFor(a);
    if (!x || !a.day) continue;
    const w = weekOf(a.day);
    byWeek.set(w, (byWeek.get(w) || 0) + x);
  }
  const current = weekOf(today);
  const thisWeek = byWeek.get(current) || 0;
  let bestBefore = 0;
  for (const [w, x] of byWeek) if (w !== current && x > bestBefore) bestBefore = x;
  return { thisWeek, best: Math.max(thisWeek, bestBefore), bestBefore };
}
