import { useStore } from "../state/store.jsx";
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
  const { state, act } = useStore();
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

  const courses = state.courses.filter(c => c.status !== "paused");
  const dateLabel = new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const doneToday = plan.tasks.length === 0 && plan.spentSec > 0;

  const start = () => nav.startSession({ tasks: plan.tasks, mode: "session", daily: true });

  if (!state.courses.length) {
    return (
      <div className="page page-narrow">
        <div className="page-head"><div><h1>Today</h1><div className="page-sub">{dateLabel}</div></div></div>
        <div className="card-stack" style={{ marginTop: 18 }}>
          <article className="index-card">
            <div className="index-card-head"><span className="ability">Get started</span></div>
            <div className="ruled">
              <div className="plan-title">Add what you're studying.</div>
              <div className="plan-sub">Create a course for a book or class, then add a chapter at a time as you work through it. AeroFlash finds the concepts worth remembering and schedules short daily reviews so you keep them for good.</div>
            </div>
            <div className="plan-foot"><button className="btn btn-primary btn-lg" onClick={() => nav.go("courses", { create: true })}><Icon name="plus" size={16}/>Create a course</button></div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Today</h1><div className="page-sub">{dateLabel}</div></div>
      </div>

      {state._migrated && (
        <div style={{ marginBottom: 22 }}>
          <Notice tone="sky">
            Your flashcards from the previous version were imported with their schedules and review history. Each topic is now a course; add the original chapters or notes to get explain and apply questions.{" "}
            <button className="link" onClick={() => act("migrated/dismiss")}>Got it</button>
          </Notice>
        </div>
      )}

      <div className="grid-2">
        <div>
          <div className="card-stack">
            <article className="index-card">
              <div className="index-card-head">
                <span className="ability">{doneToday ? "Done for today" : "Today's session"}</span>
                <span className="grow"/>
                {plan.spentSec > 0 && <span>{formatMinutes(plan.spentSec)} studied today</span>}
              </div>
              <div className="ruled">
                {plan.tasks.length > 0 ? (
                  <>
                    <div className="plan-title">{plan.tasks.length} question{plan.tasks.length === 1 ? "" : "s"}, about {formatMinutes(plan.estSec)}</div>
                    <div className="plan-courses">
                      {plan.byCourse.map(b => (
                        <div key={b.courseId} className="plan-course">
                          <span className="dot" style={{ background: ix.course[b.courseId]?.color }}/>
                          <span>{ix.course[b.courseId]?.name}</span>
                          <span className="num">{b.count}{b.fresh ? `, ${b.fresh} new` : ""}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="plan-title">{doneToday ? "You're done for today." : hasContent ? "Nothing is due right now." : "No questions yet."}</div>
                    <div className="plan-sub">
                      {doneToday
                        ? "Everything important is scheduled. Tomorrow's session will pick up where this one left off."
                        : hasContent
                          ? "Add the next chapter of something you're reading to bring in new concepts."
                          : "Add material to one of your courses to generate questions."}
                    </div>
                  </>
                )}
              </div>
              {plan.tasks.length > 0 && (
                <>
                  <div className="plan-foot">
                    <button className="btn btn-primary btn-lg" onClick={start}><Icon name="play" size={14}/>Start session</button>
                    <span className="muted small">Budget {state.settings.dailyMinutes} min a day</span>
                  </div>
                  {planNote(plan) && <div className="plan-note">{planNote(plan)}</div>}
                </>
              )}
              {plan.tasks.length === 0 && plan.laterToday > 0 && <div className="plan-note">{planNote(plan)}</div>}
            </article>
          </div>

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
              {state.courses.length > courses.length && (
                <div className="list-row static muted small">{state.courses.length - courses.length} paused course{state.courses.length - courses.length === 1 ? "" : "s"} not shown</div>
              )}
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 28 }}>
          <div className="panel panel-pad">
            <h2 className="h" style={{ marginBottom: 4 }}>This week</h2>
            <div className="muted small">Review time already scheduled. The planner keeps new material in check so this stays near your budget.</div>
            <Week state={state} now={now}/>
          </div>

          {slipping.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h2>Slipping</h2><span className="muted small">prioritized in your sessions</span></div>
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
