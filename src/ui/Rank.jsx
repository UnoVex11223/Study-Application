// Your rank, in one quiet line: its name, a thin bar to the next rank, and
// the XP just earned. The bar starts where you were and fills to now; a new
// rank is named in gold (the full ladder is on the Ranks page).

import { useEffect, useState } from "react";
import { rankFor } from "../lib/xp.js";
import { cx } from "./cx.js";

export function RankLine({ xp, gained = 0, className }) {
  const now = rankFor(xp);
  const before = rankFor(xp - gained);
  const up = gained > 0 && now.index > before.index;
  const [shown, setShown] = useState(gained > 0 ? (up ? 0 : before.progress) : now.progress);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(now.progress));
    return () => cancelAnimationFrame(t);
  }, [now.progress]);
  return (
    <div className={cx("rank-line", up && "up", className)} aria-label={`${now.name}, ${now.xp} XP`}>
      <span className="rank-line-name">{up ? `Now ${now.name}` : now.name}</span>
      <span className="rank-line-track"><span style={{ width: `${Math.round(shown * 1000) / 10}%` }}/></span>
      <span className="rank-line-xp num">{gained > 0 ? `+${gained} XP` : `${now.xp.toLocaleString()} XP`}</span>
    </div>
  );
}
