// Your level, in one quiet line: "Level 6", a thin bar to the next level, and
// your XP. With `gained`, the bar starts where it was before and fills to now
// (crossing into a new level, it says so).

import { useEffect, useState } from "react";
import { levelFor } from "../lib/xp.js";
import { cx } from "./cx.js";

export function LevelLine({ xp, gained = 0, className }) {
  const now = levelFor(xp);
  const before = levelFor(xp - gained);
  const up = gained > 0 && now.level > before.level;
  // Start from where you were (or empty, after a level-up) and fill to now.
  const [shown, setShown] = useState(gained > 0 ? (up ? 0 : before.progress) : now.progress);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(now.progress));
    return () => cancelAnimationFrame(t);
  }, [now.progress]);
  return (
    <div className={cx("level-line", up && "up", className)} aria-label={`Level ${now.level}, ${now.xp} XP`}>
      <span className="level-name">Level {now.level}</span>
      <span className="level-track"><span style={{ width: `${Math.round(shown * 1000) / 10}%` }}/></span>
      <span className="level-xp num">{gained > 0 ? `+${gained} XP` : `${now.xp.toLocaleString()} XP`}</span>
    </div>
  );
}
