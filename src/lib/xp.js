// XP: a little for every answer you get, more for proving a concept in the
// mastery test. Worked out from your answers (nothing extra is stored), so it
// syncs with them and counts everything you've done since you started.
//   right, without help   10
//   partly right           5
//   right in a mastery test 50 (it masters the concept)
// Levels get steadily longer: level n starts at 50·(n−1)² XP (level 2 at 50,
// 5 at 800, 10 at 4,050, 20 at 18,050).

export const XP = { right: 10, partly: 5, test: 50 };

/** XP for one answer: { verdict, aided, mode }. */
export function xpFor(a) {
  if (!a || a.aided || a.mode === "pretest") return 0;
  if (a.mode === "test") return a.verdict === "correct" ? XP.test : 0;
  if (a.verdict === "correct") return XP.right;
  if (a.verdict === "partial") return XP.partly;
  return 0;
}

export const totalXp = (attempts = []) => attempts.reduce((n, a) => n + xpFor(a), 0);

/** Where an XP total stands: { level, xp, from, to (this level's bounds), progress (0–1) }. */
export function levelFor(xp) {
  const total = Math.max(0, Math.floor(xp || 0));
  const level = Math.floor(Math.sqrt(total / 50)) + 1;
  const from = 50 * (level - 1) ** 2, to = 50 * level ** 2;
  return { level, xp: total, from, to, progress: (total - from) / (to - from) };
}
