// XP and ranks. XP comes from your answers (nothing extra is stored), so it
// syncs with them and counts everything you've done since you started:
//   right, without help    10
//   partly right            5
//   right in a mastery test 50 (it masters the concept)
//
// Ranks climb a plain ladder: Novice, Apprentice, Scholar, Expert, Master,
// Sage, each in three tiers (Novice I, II, III, then Apprentice I, …). Sage
// has no last tier: after Sage III comes Sage IV, and so on, so there is
// always a next rank. Rank r (0 = Novice I) starts at 100·r² XP, so each
// takes a little longer than the last (Apprentice I at 900, Scholar I at
// 3,600, Expert I at 8,100, Master I at 14,400, Sage I at 22,500).

export const XP = { right: 10, partly: 5, test: 50 };
export const RANKS = ["Novice", "Apprentice", "Scholar", "Expert", "Master", "Sage"];
const TIERS = 3;

/** XP for one answer: { verdict, aided, mode }. */
export function xpFor(a) {
  if (!a || a.aided || a.mode === "pretest") return 0;
  if (a.mode === "test") return a.verdict === "correct" ? XP.test : 0;
  if (a.verdict === "correct") return XP.right;
  if (a.verdict === "partial") return XP.partly;
  return 0;
}

export const totalXp = (attempts = []) => attempts.reduce((n, a) => n + xpFor(a), 0);

/** Roman numerals for tiers (I, II, III, IV, …). */
function roman(n) {
  const marks = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, m] of marks) while (n >= v) { out += m; n -= v; }
  return out;
}

/** The name of rank r: 0 → "Novice I", 2 → "Novice III", 3 → "Apprentice I", … 15 → "Sage I", 18 → "Sage IV", … */
export function rankName(r) {
  const i = Math.min(Math.floor(r / TIERS), RANKS.length - 1);
  return `${RANKS[i]} ${roman(r - i * TIERS + 1)}`;
}

/** XP at which rank r starts. */
export const rankStart = (r) => 100 * r * r;

/** Where an XP total stands: { index, name, next, xp, from, to, progress (0–1), toGo }. */
export function rankFor(xp) {
  const total = Math.max(0, Math.floor(xp || 0));
  const index = Math.floor(Math.sqrt(total / 100));
  const from = rankStart(index), to = rankStart(index + 1);
  return { index, name: rankName(index), next: rankName(index + 1), xp: total, from, to, progress: (total - from) / (to - from), toGo: to - total };
}
