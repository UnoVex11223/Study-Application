// Today: one column. The session (how many questions, how long, from which
// courses) and a button to start it; under it, only the things waiting on you
// (questions to fix, notes to process, books to recall). How the weeks ahead
// look is on Progress.

import { useState } from "react";
import { useStore } from "../state/store.jsx";
import { useSync } from "../state/sync.jsx";
import { dueForRecall } from "../lib/recall.js";
import { useNav } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import { index } from "../lib/model.js";
import { formatMinutes } from "../lib/time.js";
import FixPanel from "./FixPanel.jsx";

function planNote(plan) {
  const parts = [];
  if (plan.newCount) parts.push(`${plan.newCount} new concept${plan.newCount === 1 ? "" : "s"} included.`);
  if (plan.deferred) parts.push(`${plan.deferred} review${plan.deferred === 1 ? "" : "s"} moved to later days to keep today within your budget.`);
  else if (plan.throttle === "forecast") parts.push("No new concepts today: the coming week already has a full load of reviews.");
  else if (plan.throttle === "forecast-half") parts.push("Fewer new concepts than usual: the coming week is busy.");
  if (plan.laterToday) parts.push(`${plan.laterToday} short follow-up${plan.laterToday === 1 ? "" : "s"} will be ready later today.`);
  return parts.join(" ");
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function Today({ plan }) {
  const { state } = useStore();
  const sync = useSync();
  const nav = useNav();
  const ix = index(state);
  const now = nav.now;
  const [fixing, setFixing] = useState(Boolean(nav.route.fix));
  const hasContent = state.items.length > 0;

  const flagged = state.items.filter(i => i.flag).length;
  const inbox = state.notes.filter(n => n.status === "inbox").length;
  const recallDue = dueForRecall(state.shelf, now).length;
  const dateLabel = new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const doneToday = plan.tasks.length === 0 && plan.spentSec > 0;
  const budget = Math.max(1, state.settings.dailyMinutes * 60);
  const start = () => nav.startSession({ tasks: plan.tasks, mode: "session", daily: true });

  const head = <div className="page-head"><div><h1>Today</h1><div className="page-sub">{dateLabel}</div></div></div>;

  if (!state.courses.length) {
    return (
      <div className="page today">
        {head}
        <article className="today-hero">
          <div className="hero-label">Get started</div>
          <div className="hero-title">Add what you're studying</div>
          <div className="hero-foot" style={{ flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-lg" onClick={() => nav.go("courses", { create: true, at: Date.now() })}><Icon name="plus" size={16}/>Create a course</button>
            {sync?.status && !sync.status.enabled && (
              <button className="btn btn-lg" onClick={() => nav.go("settings")}>Sync from another computer</button>
            )}
          </div>
        </article>
      </div>
    );
  }

  const waiting = [
    flagged > 0 && { key: "fix", icon: "flag", text: `${plural(flagged, "question")} out of your sessions until fixed`, action: "Review", go: () => setFixing(true) },
    inbox > 0 && { key: "notes", icon: "note", text: `${plural(inbox, "note")} in your inbox`, action: "Process", go: () => nav.go("notes") },
    recallDue > 0 && { key: "recall", icon: "shelf", text: `${plural(recallDue, "book")} to recall from your shelf`, action: "Recall", go: () => nav.go("shelf", { recall: true, at: Date.now() }) },
  ].filter(Boolean);

  return (
    <div className="page today">
      {head}

      <article className="today-hero">
        <div className="row">
          <span className="hero-label grow">{doneToday ? "Done for today" : "Today's session"}</span>
          {plan.spentSec > 0 && <span className="muted small num">{formatMinutes(plan.spentSec)} studied today</span>}
        </div>
        {plan.tasks.length > 0 ? (
          <>
            <div className="hero-title">{plural(plan.tasks.length, "question")}</div>
            <p className="hero-sub">About {formatMinutes(plan.estSec)} of your {state.settings.dailyMinutes}-minute daily budget</p>
            <div className="stackbar today-bar" aria-hidden="true">
              {plan.byCourse.map(b => (
                <span key={b.courseId} style={{ width: `${Math.min(100, (b.estSec / budget) * 100)}%`, background: ix.course[b.courseId]?.color }}/>
              ))}
            </div>
            <div className="today-courses">
              {plan.byCourse.map(b => (
                <div key={b.courseId} className="today-course">
                  <span className="dot" style={{ background: ix.course[b.courseId]?.color }}/>
                  <span className="grow ell">{ix.course[b.courseId]?.name}</span>
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

      {waiting.length > 0 && (
        <div className="today-waiting">
          {waiting.map(w => (
            <button key={w.key} className="today-row" onClick={w.go}>
              <Icon name={w.icon} size={16}/>
              <span className="grow">{w.text}</span>
              <span className="today-action">{w.action}<Icon name="chevron" size={14}/></span>
            </button>
          ))}
        </div>
      )}

      {fixing && <FixPanel onClose={() => setFixing(false)}/>}
    </div>
  );
}
