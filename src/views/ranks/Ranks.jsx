// Ranks: your rank, the bar to the next one, and how far that is. Nothing
// else. (How XP and ranks work: lib/xp.js.)

import { useMemo } from "react";
import { useStore } from "../../state/store.jsx";
import { Page } from "../../ui/layout.jsx";
import { totalXp, rankFor } from "../../lib/xp.js";

export default function Ranks() {
  const { state } = useStore();
  const xp = useMemo(() => totalXp(state.attempts), [state.attempts]);
  const r = rankFor(xp);
  return (
    <Page width="narrow" className="ranks-page">
      <section className="rank-hero" aria-label="Your rank">
        <h1 className="rank-hero-name">{r.name}</h1>
        <div className="rank-bar" role="img" aria-label={`${Math.round(r.progress * 100)}% of the way to ${r.next}`}>
          <span style={{ width: `${Math.max(1.5, r.progress * 100)}%` }}/>
        </div>
        <div className="rank-hero-next num">{r.toGo.toLocaleString()} XP to {r.next}</div>
      </section>
    </Page>
  );
}
