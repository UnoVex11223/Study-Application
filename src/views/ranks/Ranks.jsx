// Ranks: how far your XP has taken you, as kyu and dan grades (lib/xp.js).
// Your rank and the bar to the next one at the top, this week against your
// best week (it starts again every Monday), and the whole ladder: the grades
// above you, the one you hold, and the ones you've climbed past. There is no
// top: after 10th dan comes 11th.

import { useMemo } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import { Page, PageHeader } from "../../ui/layout.jsx";
import { cx } from "../../ui/cx.js";
import { dayKey } from "../../lib/time.js";
import { totalXp, rankFor, rankName, rankStart, weeklyXp, KYU, XP } from "../../lib/xp.js";

const n = (x) => x.toLocaleString();

export default function Ranks() {
  const { state } = useStore();
  const nav = useNav();
  const today = dayKey(nav.now, state.settings.rolloverHour);
  const xp = useMemo(() => totalXp(state.attempts), [state.attempts]);
  const week = useMemo(() => weeklyXp(state.attempts, today), [state.attempts, today]);
  const r = rankFor(xp);
  // The ladder from the top down: three grades above yours (at least to 1st dan), down to 10th kyu.
  const top = Math.max(r.index + 3, KYU);
  const ladder = Array.from({ length: top + 1 }, (_, i) => top - i);
  const weekPct = week.best ? week.thisWeek / week.best : 0;

  return (
    <Page width="narrow" className="ranks-page">
      <PageHeader title="Ranks"/>

      <section className="rank-hero">
        <div className="rank-hero-name">{r.name}</div>
        <div className="rank-bar"><span style={{ width: `${Math.max(1.5, r.progress * 100)}%` }}/></div>
        <div className="rank-hero-meta">
          <span className="num">{n(xp)} XP</span>
          <span className="num">{n(r.toGo)} to {r.next}</span>
        </div>
      </section>

      <section className="rank-week">
        <div className="rank-week-head">
          <span>This week</span>
          <span className="num">{n(week.thisWeek)} XP</span>
        </div>
        <div className="rank-bar thin"><span style={{ width: `${weekPct * 100}%` }}/></div>
        <div className="rank-week-meta">
          {!week.bestBefore ? "Your first week" : week.thisWeek >= week.bestBefore ? "Your best week yet" : `${n(week.bestBefore - week.thisWeek)} to beat your best week (${n(week.bestBefore)} XP)`}
        </div>
      </section>

      <ol className="rank-ladder" aria-label="Ranks">
        <li className="rank-more">and on, with no top</li>
        {ladder.map(i => (
          <li key={i} className={cx(i < r.index && "done", i === r.index && "on", i === KYU && "first-dan")}>
            <span className="rank-mark" aria-hidden="true"/>
            <span className="rank-ladder-name">{rankName(i)}</span>
            <span className="rank-ladder-xp num">{n(rankStart(i))}</span>
          </li>
        ))}
      </ol>

      <p className="rank-how">A right answer is {XP.right} XP, partly right {XP.partly}, and each concept you prove in a mastery test {XP.test}.</p>
    </Page>
  );
}
