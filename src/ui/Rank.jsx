// Your rank after a session or a test, in one quiet line: the XP just
// earned and the rank you hold ("Now …" in gold when it's a new one).

import { rankFor } from "../lib/xp.js";
import { cx } from "./cx.js";

export function RankLine({ xp, gained = 0, className }) {
  const now = rankFor(xp);
  const up = gained > 0 && now.index > rankFor(xp - gained).index;
  return (
    <div className={cx("rank-line", up && "up", className)}>
      {gained > 0 && <span className="rank-line-xp num">+{gained} XP</span>}
      <span className="rank-line-name">{up ? `Now ${now.name}` : now.name}</span>
    </div>
  );
}
