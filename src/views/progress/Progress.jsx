// Progress: how many days in a row you have studied, then the last six
// months of study days, one square per day, darker for more answers. How each
// course is going is on its own page; XP and ranks are on Ranks.

import { useMemo } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import { Page, PageHeader } from "../../ui/layout.jsx";
import { cx } from "../../ui/cx.js";
import { dayKey, keyToDate } from "../../lib/time.js";
import { streaks } from "../../lib/history.js";
import { plural } from "../../lib/format.js";

const WEEKS = 26;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const heatLevel = (n) => (n === 0 ? 0 : n < 8 ? 1 : n < 20 ? 2 : n < 40 ? 3 : 4);

/** Study days, a column per week (Sunday at the top), with the months along the top. */
function Activity({ counts, today }) {
  const end = keyToDate(today);
  const start = new Date(end);
  start.setDate(start.getDate() - (WEEKS * 7 - 1));
  start.setDate(start.getDate() - start.getDay());
  const weeks = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || !weeks.length) weeks.push([]);
    const k = dayKey(d.getTime() + 5 * 3600e3, 0);
    weeks[weeks.length - 1].push({ k, n: counts[k] || 0, date: new Date(d) });
  }
  let lastMonth = -1;
  const months = weeks.map((w, i) => {
    const m = w[0].date.getMonth();
    const show = m !== lastMonth && i < weeks.length - 2;
    if (show) lastMonth = m;
    return show && (i > 0 || w[0].date.getDate() <= 7) ? MONTHS[m] : "";
  });
  return (
    <div className="activity" style={{ "--weeks": weeks.length }}>
      <span/>
      <div className="activity-months">{months.map((m, i) => <span key={i}>{m}</span>)}</div>
      <div className="activity-days"><span/><span>Mon</span><span/><span>Wed</span><span/><span>Fri</span><span/></div>
      <div className="activity-grid">
        {weeks.map((w, i) => (
          <div key={i} className="activity-week" style={{ "--i": i }}>
            {w.map(c => (
              <span key={c.k} className={cx("heat", heatLevel(c.n) && `l${heatLevel(c.n)}`)}
                title={`${c.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${plural(c.n, "answer")}`}/>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Progress() {
  const { state } = useStore();
  const nav = useNav();
  const today = dayKey(nav.now, state.settings.rolloverHour);
  const counts = useMemo(() => {
    const out = {};
    for (const a of state.attempts) out[a.day] = (out[a.day] || 0) + 1;
    return out;
  }, [state.attempts]);
  const st = streaks(counts, today);
  return (
    <Page width="narrow">
      <PageHeader center title="Progress"/>
      <div className="progress-streak">
        <span className="progress-streak-n num">{st.current}</span>
        <span className="progress-streak-label">{st.current === 1 ? "day in a row" : "days in a row"}</span>
      </div>
      <Activity counts={counts} today={today}/>
    </Page>
  );
}
