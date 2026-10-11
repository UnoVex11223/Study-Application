import { useStore } from "../state/store.jsx";
import { useSync } from "../state/sync.jsx";
import { dueForRecall } from "../lib/recall.js";
import { Bar, StatusDot, Notice } from "../ui/ui.jsx";
import { useNav } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import { index } from "../lib/model.js";
import { forecastLoad } from "../lib/planner.js";
import { courseMastery, conceptMastery } from "../lib/mastery.js";
import { formatMinutes } from "../lib/time.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BAR_H = 76;

function planNote(plan) {
  const parts = [];
  if (plan.newCount) parts.push(`${plan.newCount} new concept${plan.newCount === 1 ? "" : "s"} included.`);
  if (plan.deferred) parts.push(`${plan.deferred} review${plan.deferred === 1 ? "" : "s"} moved to later days to keep today within your budget.`);
  else if (plan.throttle === "forecast") parts.push("No new concepts today: the coming week already has a full load of reviews.");
  else if (plan.throttle === "forecast-half") parts.push("Fewer new concepts than usual: the coming week is busy.");
  if (plan.laterToday) parts.push(`${plan.laterToday} short follow-up${plan.laterToday === 1 ? "" : "s"} will be ready later today.`);
  return parts.join(" ");
}

function Week({ state, now }) {
  const { sec } = forecastLoad(state, { now, days: 7 });
  const budget = state.settings.dailyMinutes * 60;
  const max = Math.max(budget * 1.25, ...sec, 1);
  const labels = sec.map((_, i) => (i === 0 ? "Today" : DAY_NAMES[new Date(now + i * 864e5).getDay()]));
  return (
    <div className="week" aria-label="Review time scheduled for the next 7 days">
      <div className="week-budget" style={{ bottom: 23 + (budget / max) * BAR_H }}>
        <span>{state.settings.dailyMinutes} min</span>
      </div>
      {sec.map((s, i) => (
        <div key={i} className="week-col" title={`${labels[i]}: about ${formatMinutes(s)} of reviews`}>
          <div className={`week-bar${s > budget ? " over" : ""}`} style={{ height: Math.max(2, (s / max) * BAR_H) }}/>
          <span className="week-day">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

export default function Today({ plan }) {
  const { state } = useStore();
  const sync = useSync();
  const nav = useNav();
  const ix = index(state);
  const now = nav.now;
  const hasContent = state.items.length > 0;

  const slipping = state.concepts
    .filter(c => !c.suspended)
    .map(c => ({ c, m: conceptMastery(state, c.id, now) }))
    .filter(x => x.m.status === "slipping")
    .sort((a, b) => b.m.lapses - a.m.lapses)
    .slice(0, 5);

  const courses = state.courses.filter(c => c.status !== "paused" && c.kind !== "notes");
  const flagged = state.items.filter(i => i.flag).length;
  const inbox = state.notes.filter(n => n.status === "inbox").length;
  const recallDue = dueForRecall(state.shelf, now).length;
  const dateLabel = new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const doneToday = plan.tasks.length === 0 && plan.spentSec > 0;

  const start = () => nav.startSession({ tasks: plan.tasks, mode: "session", daily: true });

  if (!state.courses.length) {
    return (
      <div className="page page-narrow">
        <div className="page-head"><div><h1>Today</h1><div className="page-sub">{dateLabel}</div></div></div>
        <article className="hero" style={{ marginTop: 8 }}>
          <div className="hero-label">Get started</div>
          <div className="hero-title">Add what you're studying</div>
          <div className="hero-foot" style={{ flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-lg" onClick={() => nav.go("courses", { create: true })}><Icon name="plus" size={16}/>Create a course</button>
            {sync?.status && !sync.status.enabled && (
              <button className="btn btn-lg" onClick={() => nav.go("settings")}>Sync from another computer</button>
            )}
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Today</h1><div className="page-sub">{dateLabel}</div></div>
      </div>

      <div className="grid-2">
        <div>
          <article className="hero">
            <div className="row">
              <span className="hero-label grow">{doneToday ? "Done for today" : "Today's session"}</span>
              {plan.spentSec > 0 && <span className="muted small">{formatMinutes(plan.spentSec)} studied today</span>}
            </div>
            {plan.tasks.length > 0 ? (
              <>
                <div className="hero-title">{plan.tasks.length} question{plan.tasks.length === 1 ? "" : "s"}</div>
                <p className="hero-sub">About {formatMinutes(plan.estSec)} of your {state.settings.dailyMinutes}-minute daily budget</p>
                <div className="stackbar" style={{ marginTop: 16 }} aria-hidden="true">
                  {plan.byCourse.map(b => (
                    <span key={b.courseId} style={{ width: `${Math.min(100, (b.estSec / Math.max(1, state.settings.dailyMinutes * 60)) * 100)}%`, background: ix.course[b.courseId]?.color }}/>
                  ))}
                </div>
                <div className="plan-courses">
                  {plan.byCourse.map(b => (
                    <div key={b.courseId} className="plan-course">
                      <span className="dot" style={{ background: ix.course[b.courseId]?.color }}/>
                      <span className="grow">{ix.course[b.courseId]?.name}</span>
                      <span className="num muted">{b.count}{b.fresh ? `, ${b.fresh} new` : ""}</span>
                    </div>
                  ))}
                </div>
                <div className="hero-foot">
                  <button className="btn btn-primary btn-lg" onClick={start}><Icon name="play" size={14}/>Start session</button>
                </div>
                {planNote(plan) && <p className="plan-note">{planNote(plan)}</p>}
              </>
            ) : (
              <>
                <div className="hero-title">{doneToday ? "You're done for today" : hasContent ? "Nothing is due right now" : "No questions yet"}</div>
                {plan.laterToday > 0 && <p className="plan-note">{planNote(plan)}</p>}
              </>
            )}
          </article>
          {flagged > 0 && (
            <div style={{ marginTop: 14 }}>
              <Notice icon="flag">
                {flagged} question{flagged === 1 ? " is" : "s are"} out of your sessions until fixed.{" "}
                <button className="link" onClick={() => nav.go("progress")}>Review {flagged === 1 ? "it" : "them"}</button>
              </Notice>
            </div>
          )}

          <div style={{ marginTop: 40 }}>
            <h2 className="h">Courses</h2>
            <div className="panel list">
              {courses.map(c => {
                const m = courseMastery(state, c.id, now);
                return (
                  <button key={c.id} className="list-row" onClick={() => nav.go("course", { courseId: c.id })}>
                    <span className="dot" style={{ background: c.color }}/>
                    <div className="grow">
                      <div className="list-title">{c.name}</div>
                      <div className="list-meta">
                        {m.mastered} of {m.basisCount} {m.basisIsCore ? "core " : ""}concepts mastered{c.status === "maintain" ? ", maintaining" : ""}
                      </div>
                    </div>
                    <div style={{ width: 120 }}><Bar value={m.masteryPct} tone="good"/></div>
                    <Icon name="chevron" size={16} className="muted"/>
                  </button>
                );
              })}
              {state.courses.filter(c => c.status === "paused" && c.kind !== "notes").length > 0 && (
                <div className="list-row static muted small">{state.courses.filter(c => c.status === "paused" && c.kind !== "notes").length} paused course(s) not shown</div>
              )}
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 28 }}>
          <section className="quiet-block">
            <h2 className="h">This week</h2>
            <Week state={state} now={now}/>
          </section>
          {inbox > 0 && (
            <button className="panel panel-pad notes-callout" onClick={() => nav.go("notes")}>
              <Icon name="note" size={18}/>
              <div className="grow">
                <div className="list-title">{inbox} note{inbox === 1 ? "" : "s"} in your inbox</div>
              </div>
              <Icon name="chevron" size={16} className="muted"/>
            </button>
          )}
          {recallDue > 0 && (
            <button className="panel panel-pad notes-callout" onClick={() => nav.go("shelf", { recall: true, at: Date.now() })}>
              <Icon name="shelf" size={18}/>
              <div className="grow">
                <div className="list-title">{recallDue} to recall from your shelf</div>
              </div>
              <Icon name="chevron" size={16} className="muted"/>
            </button>
          )}

          {slipping.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h2>Slipping</h2></div>
              <div className="list">
                {slipping.map(({ c }) => (
                  <button key={c.id} className="list-row" onClick={() => nav.go("course", { courseId: c.courseId, conceptId: c.id })}>
                    <StatusDot status="slipping"/>
                    <div className="grow">
                      <div className="list-title">{c.name}</div>
                      <div className="list-meta">{ix.course[c.courseId]?.name}</div>
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
