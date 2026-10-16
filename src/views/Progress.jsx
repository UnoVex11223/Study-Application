// Progress: the numbers that say how it's going, the review time coming up
// over the next two weeks, and a year of activity. Questions to fix are in a
// panel on Today; how each course is going is on its own page.

import { useMemo } from "react";
import { useStore } from "../state/store.jsx";
import { Figures, Figure, Spark } from "../ui/ui.jsx";
import { useNav, pct } from "../ui/nav.js";
import { isEvidence, conceptMastery } from "../lib/mastery.js";
import { forecastLoad, questionsPerDay } from "../lib/planner.js";
import { dayKey, addDays, keyToDate } from "../lib/time.js";
import { lastDays, perDay, milestones, runningTotal } from "../lib/history.js";

const DAY = 864e5;
const WEEKS = 53;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A year of study days, a column per week (Sunday at the top), with the months along the top. */
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
  const level = (n) => (n === 0 ? 0 : n < 8 ? 1 : n < 20 ? 2 : n < 40 ? 3 : 4);
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
              <span key={c.k} className={`heat${level(c.n) ? ` l${level(c.n)}` : ""}`}
                title={`${c.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${c.n} answer${c.n === 1 ? "" : "s"}`}/>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Reviews scheduled for each of the next 14 days, against your questions per day. */
function Forecast({ state, now }) {
  const { count } = forecastLoad(state, { now, days: 14 });
  const perDay = questionsPerDay(state.settings);
  const max = Math.max(perDay * 1.3, ...count, 1);
  return (
    <div className="forecast2">
      <div className="forecast2-plot">
        <div className="forecast2-budget" style={{ bottom: `${(perDay / max) * 100}%` }}><span>{perDay} a day</span></div>
        {count.map((n, i) => {
          const d = new Date(now + i * DAY);
          return (
            <div key={i} className={`forecast2-col${i === 0 ? " today" : ""}`}
              title={`${d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}: ${n} review${n === 1 ? "" : "s"} due`}>
              <div className={`forecast2-bar${n > perDay ? " over" : ""}`} style={{ height: `${Math.max(1.5, (n / max) * 100)}%`, "--i": i }}/>
            </div>
          );
        })}
      </div>
      <div className="forecast2-labels">
        {count.map((_, i) => {
          const d = new Date(now + i * DAY);
          return (
            <div key={i} className={`forecast2-label${i === 0 ? " today" : ""}`}>
              <span>{i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" })}</span>
              <span>{d.getDate()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Progress() {
  const { state } = useStore();
  const nav = useNav();
  const now = nav.now;
  const today = dayKey(now, state.settings.rolloverHour);

  const data = useMemo(() => {
    const counts = {};
    for (const a of state.attempts) counts[a.day] = (counts[a.day] || 0) + 1;

    let streak = 0;
    for (let k = counts[today] ? today : addDays(today, -1); counts[k]; k = addDays(k, -1)) streak++;

    const weekAgo = addDays(today, -6);
    const week = state.attempts.filter(a => a.day >= weekAgo);

    // Delayed recall: answers to questions last seen a week or more earlier.
    const lastSeen = {};
    let delayedN = 0, delayedOk = 0;
    for (const a of state.attempts) {
      const prev = lastSeen[a.itemId];
      if (prev != null && a.ts - prev >= 7 * DAY && a.verdict !== "ungraded" && a.ts >= now - 90 * DAY) {
        delayedN++;
        if (isEvidence(a)) delayedOk++;
      }
      lastSeen[a.itemId] = a.ts;
    }

    const active = state.concepts.filter(c => !c.suspended);
    const per = active.map(c => conceptMastery(state, c.id, now));
    const mastered = per.filter(m => m.status === "mastered").length;
    const started = per.filter(m => m.started).length;

    const fortnight = lastDays(today, 14);
    const perDayAnswers = perDay(state.attempts, fortnight);
    const masteredByDay = runningTotal(milestones(state, active, now).mastered, lastDays(today, 30));
    const yearAnswers = state.attempts.filter(a => a.ts >= now - 365 * DAY).length;

    return { counts, streak, week, delayedN, delayedOk, mastered, started, perDayAnswers, masteredByDay, yearAnswers };
  }, [state, today, now]);

  return (
    <div className="page progress">
      <div className="page-head"><div><h1>Progress</h1></div></div>

      <Figures>
        <Figure value={data.streak} label="day streak"
          spark={<Spark kind="dots" values={data.perDayAnswers} width={96} height={12} label="Days studied in the last two weeks"/>}/>
        <Figure value={data.week.length} label="answers this week"
          spark={<Spark kind="bars" values={data.perDayAnswers} width={70} label="Answers per day, last two weeks"/>}/>
        <Figure value={data.delayedN ? pct(data.delayedOk / data.delayedN) : "–"} label="recalled after a week or more"/>
        <Figure value={data.mastered} of={data.started} label="started concepts mastered"
          spark={<Spark values={data.masteredByDay} label="Concepts mastered over the last 30 days"/>}/>
      </Figures>

      <section className="progress-block">
        <div className="progress-head"><h2 className="h">Next two weeks</h2></div>
        <Forecast state={state} now={now}/>
      </section>

      <section className="progress-block">
        <div className="progress-head">
          <h2 className="h">Activity</h2>
          <span className="muted small num">{data.yearAnswers} answer{data.yearAnswers === 1 ? "" : "s"} in the last year</span>
        </div>
        <Activity counts={data.counts} today={today}/>
      </section>
    </div>
  );
}
