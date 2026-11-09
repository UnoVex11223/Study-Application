// Ranks: your rank in the middle of the page, inside a thin ring that fills
// as you get closer to the next one, and how far that is. Nothing else.
// (How XP and ranks work: lib/xp.js.)

import { useMemo } from "react";
import { useStore } from "../../state/store.jsx";
import { Page } from "../../ui/layout.jsx";
import { totalXp, rankFor } from "../../lib/xp.js";

const R = 104, C = 2 * Math.PI * R;

export default function Ranks() {
  const { state } = useStore();
  const xp = useMemo(() => totalXp(state.attempts), [state.attempts]);
  const r = rankFor(xp);
  return (
    <Page width="narrow" className="ranks-page">
      <section className="rank-hero" aria-label={`${r.name}: ${r.toGo} XP to ${r.next}`}>
        <div className="rank-ring">
          <svg viewBox="0 0 240 240" aria-hidden="true">
            <circle className="rank-ring-track" cx="120" cy="120" r={R}/>
            <circle className="rank-ring-fill" cx="120" cy="120" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.01, r.progress))}/>
          </svg>
          <div className="rank-ring-label">
            <span className="rank-ring-name">{r.name}</span>
          </div>
        </div>
        <div className="rank-hero-next num">{r.toGo.toLocaleString()} XP to {r.next}</div>
      </section>
    </Page>
  );
}
