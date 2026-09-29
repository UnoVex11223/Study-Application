import { useMemo } from "react";
import { useStore } from "../state/store.jsx";
import { Bar, StatusDot } from "../ui/ui.jsx";
import { useNav, pct } from "../ui/nav.js";
import { index, ABILITIES } from "../lib/model.js";
import { conceptMastery, courseMastery, abilityBreakdown, isEvidence } from "../lib/mastery.js";
import { forecastLoad } from "../lib/planner.js";
import { FLAG_REASONS } from "../lib/quality.js";
import Markdown from "../ui/Markdown.jsx";
import FixQuestion from "./FixQuestion.jsx";
import { dayKey, addDays, keyToDate, formatMinutes } from "../lib/time.js";

const DAY = 864e5;

function Heatmap({ counts, today }) {
  const weeks = 22;
  const end = keyToDate(today);
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay()); // align columns to weeks
  const cells = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d.getTime() + 5 * 3600e3, 0);
    const n = counts[k] || 0;
    const lvl = n === 0 ? 0 : n < 8 ? 1 : n < 20 ? 2 : n < 40 ? 3 : 4;
    cells.push(<div key={k} className={`heat${lvl ? ` l${lvl}` : ""}`} title={`${d.toLocaleDateString()}: ${n} answer${n === 1 ? "" : "s"}`}/>);
  }
  return <div className="heatmap">{cells}</div>;
}

function Forecast({ state, now }) {
  const { sec } = forecastLoad(state, { now, days: 14 });
  const budget = state.settings.dailyMinutes * 60;
  const max = Math.max(budget * 1.25, ...sec, 1);
  const H = 90;
  return (
    <div className="forecast">
      <div className="week-budget" style={{ bottom: 23 + (budget / max) * H }}><span>{state.settings.dailyMinutes} min budget</span></div>
      {sec.map((s, i) => {
        const d = new Date(now + i * DAY);
        return (
          <div key={i} className="week-col" title={`${d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}: about ${formatMinutes(s)}`}>
            <div className={`week-bar${s > budget ? " over" : ""}`} style={{ height: Math.max(2, (s / max) * H) }}/>
            <span className="week-day">{i === 0 ? "Today" : d.getDate()}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Progress() {
  const { state } = useStore();
  const nav = useNav();
  const ix = index(state);
  const now = nav.now;
  const today = dayKey(now, state.settings.rolloverHour);

  const data = useMemo(() => {
    const counts = {};
    for (const a of state.attempts) counts[a.day] = (counts[a.day] || 0) + 1;

    let streak = 0;
    for (let k = counts[today] ? today : addDays(today, -1); counts[k]; k = addDays(k, -1)) streak++;

    const weekAgo = addDays(today, -6);
    const week = state.attempts.filter(a => a.day >= weekAgo);
    const weekSec = week.reduce((s, a) => s + Math.min((a.ms || 0) / 1000, 300), 0);

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

    const perConcept = state.concepts.filter(c => !c.suspended).map(c => ({ c, m: conceptMastery(state, c.id, now) }));
    const mastered = perConcept.filter(x => x.m.status === "mastered").length;
    const started = perConcept.filter(x => x.m.started).length;
    const weak = perConcept.filter(x => x.m.status === "slipping" || x.m.lapses >= 3)
      .sort((a, b) => b.m.lapses - a.m.lapses).slice(0, 8);

    const misc = {};
    for (const a of state.attempts) {
      if (a.ts < now - 60 * DAY) continue;
      for (const m of a.misconceptions || []) {
        const key = `${a.conceptId}::${m}`;
        (misc[key] ||= { conceptId: a.conceptId, text: m, n: 0 }).n++;
      }
    }
    const misconceptions = Object.values(misc).sort((a, b) => b.n - a.n).slice(0, 6);

    return { counts, streak, week, weekSec, delayedN, delayedOk, mastered, started, weak, misconceptions };
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const abilities = abilityBreakdown(state, { now });
  const flagged = state.items.filter(i => i.flag).sort((a, b) => (b.flag.at || 0) - (a.flag.at || 0));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Progress</h1>
          <div className="page-sub">What you can recall and use without help, measured over time.</div>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 28 }}>
        <div className="stat"><div className="stat-value">{data.streak}</div><div className="stat-label">day streak</div></div>
        <div className="stat"><div className="stat-value">{data.week.length}</div><div className="stat-label">answers this week, {formatMinutes(data.weekSec)}</div></div>
        <div className="stat">
          <div className="stat-value">{data.delayedN ? pct(data.delayedOk / data.delayedN) : "–"}</div>
          <div className="stat-label">recalled after a week or more</div>
        </div>
        <div className="stat"><div className="stat-value">{data.mastered}<span className="muted" style={{ fontSize: 15 }}> / {data.started}</span></div><div className="stat-label">started concepts mastered</div></div>
      </div>

      <div className="grid-2">
        <div className="stack" style={{ gap: 28 }}>
          <div className="panel panel-pad">
            <h2 className="h" style={{ marginBottom: 4 }}>Next two weeks</h2>
            <p className="muted small">Estimated review time per day. Amber days are over budget; the planner holds back new material until they settle.</p>
            <Forecast state={state} now={now}/>
          </div>

          <div className="panel panel-pad">
            <h2 className="h">Activity</h2>
            <Heatmap counts={data.counts} today={today}/>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Courses</h2></div>
            <div className="list">
              {state.courses.filter(c => c.kind !== "notes").map(c => {
                const m = courseMastery(state, c.id, now);
                return (
                  <button key={c.id} className="list-row" onClick={() => nav.go("course", { courseId: c.id })}>
                    <span className="dot" style={{ background: c.color }}/>
                    <div className="grow">
                      <div className="list-title">{c.name}</div>
                      <div className="list-meta">{m.mastered} of {m.basisCount} mastered, {m.introduced} of {m.total} started</div>
                    </div>
                    <div style={{ width: 140 }}><Bar value={m.masteryPct} tone="good"/></div>
                    <span className="num small muted" style={{ width: 40, textAlign: "right" }}>{pct(m.masteryPct)}</span>
                  </button>
                );
              })}
              {!state.courses.length && <div className="list-row static muted">No courses yet.</div>}
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 28 }}>
          <div className="panel panel-pad">
            <h2 className="h" style={{ marginBottom: 4 }}>By type of question</h2>
            <p className="muted small" style={{ marginBottom: 10 }}>Right the first time without help, last 60 days. Strong recall with weak application means you know the words but should practice using them.</p>
            {Object.entries(abilities).map(([k, v]) => (
              <div key={k} className="ability-row">
                <span>{ABILITIES[k].label}</span>
                <Bar value={v.attempts ? v.correct / v.attempts : 0} tone="good"/>
                <span className="num small muted" style={{ textAlign: "right" }}>{v.attempts ? `${pct(v.correct / v.attempts)} of ${v.attempts}` : "–"}</span>
              </div>
            ))}
          </div>

          {flagged.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h2>Questions to fix</h2><span className="muted small">out of your sessions</span></div>
              <div className="list">
                {flagged.map(it => {
                  const c = ix.concept[it.conceptId];
                  return (
                    <div key={it.id} className="list-row static" style={{ alignItems: "flex-start", flexDirection: "column", gap: 8 }}>
                      <div className="section-stats"><span>{c?.name}</span><span>{(FLAG_REASONS[it.flag.reason] ?? "flagged").toLowerCase()}</span></div>
                      <Markdown>{it.prompt}</Markdown>
                      {c && <FixQuestion item={it} concept={c}/>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-head"><h2>Weak spots</h2></div>
            <div className="list">
              {data.weak.map(({ c, m }) => (
                <button key={c.id} className="list-row" onClick={() => nav.go("course", { courseId: c.courseId, conceptId: c.id })}>
                  <StatusDot status={m.status}/>
                  <div className="grow">
                    <div className="list-title">{c.name}</div>
                    <div className="list-meta">{ix.course[c.courseId]?.name}{m.lapses ? `, missed ${m.lapses}×` : ""}</div>
                  </div>
                </button>
              ))}
              {!data.weak.length && <div className="list-row static muted small">Nothing is slipping right now.</div>}
            </div>
            {data.weak.some(x => x.m.lapses >= 4) && (
              <p className="muted small" style={{ padding: "0 18px 14px" }}>A concept missed four or more times usually needs a clearer question or a prerequisite you haven't learned. Open it to edit its questions or check what it builds on.</p>
            )}
          </div>

          {data.misconceptions.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h2>Recurring misconceptions</h2></div>
              <div className="list">
                {data.misconceptions.map((m, i) => (
                  <button key={i} className="list-row" onClick={() => ix.concept[m.conceptId] && nav.go("course", { courseId: ix.concept[m.conceptId].courseId, conceptId: m.conceptId })}>
                    <div className="grow">
                      <div>{m.text}</div>
                      <div className="list-meta">{ix.concept[m.conceptId]?.name ?? "Deleted concept"}{m.n > 1 ? `, ${m.n} times` : ""}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
