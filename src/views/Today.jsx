// Today: the same number of questions every day. The page shows how many are
// left as one big number and a row of marks, one per question (filled as you
// answer them, coloured by course until then), which courses they come from,
// and a button to start. Under it, only the things waiting on you: questions
// to fix, notes to process, books to recall. No time estimates: how long you
// study is up to you.

import { useMemo, useState } from "react";
import { useStore } from "../state/store.jsx";
import { useSync } from "../state/sync.jsx";
import { dueForRecall } from "../lib/recall.js";
import { buildPlan } from "../lib/planner.js";
import { useNav } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import { index } from "../lib/model.js";
import FixPanel from "./FixPanel.jsx";

const EXTRA = 5; // "5 more" after the day's questions are done
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One short line about the day, only when there's something worth knowing. */
function planNote(plan) {
  if (plan.short && plan.tasks.length) return `That's everything due or ready to start right now. Add material to fill your ${plan.perDay}.`;
  if (plan.deferred) return `${plural(plan.deferred, "more review is", "more reviews are")} due; ${plan.deferred === 1 ? "it comes" : "they come"} first tomorrow.`;
  if (plan.throttle === "forecast") return "No new concepts today: the week ahead is already full of reviews.";
  if (plan.throttle === "forecast-half") return "Fewer new concepts today: the week ahead is busy.";
  return "";
}

export default function Today({ plan }) {
  const { state, act } = useStore();
  const sync = useSync();
  const nav = useNav();
  const ix = index(state);
  const now = nav.now;
  const [fixing, setFixing] = useState(Boolean(nav.route.fix));

  const flagged = state.items.filter(i => i.flag).length;
  const inbox = state.notes.filter(n => n.status === "inbox").length;
  const recallDue = dueForRecall(state.shelf, now).length;
  const dateLabel = new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const left = plan.tasks.length;
  const finished = left === 0 && plan.done > 0;
  // Is there anything worth asking if you want a few more?
  const more = useMemo(() => {
    if (!finished) return 0;
    const day = plan.today;
    return buildPlan({ ...state, days: { ...state.days, [day]: { ...state.days?.[day], extra: (state.days?.[day]?.extra || 0) + EXTRA } } }, { now }).tasks.length;
  }, [finished, state, plan.today, now]);

  const start = (tasks = plan.tasks) => nav.startSession({ tasks, mode: "session", daily: true });
  const keepGoing = () => {
    const day = plan.today;
    const next = buildPlan({ ...state, days: { ...state.days, [day]: { ...state.days?.[day], extra: (state.days?.[day]?.extra || 0) + EXTRA } } }, { now });
    act("day/extra", { count: EXTRA });
    if (next.tasks.length) start(next.tasks);
  };

  const head = <h1 className="today-date">{dateLabel}</h1>;

  if (!state.courses.length) {
    return (
      <div className="page today">
        {head}
        <section className="today-main">
          <div className="today-title">Add what you're studying</div>
          <div className="today-foot">
            <button className="btn btn-primary btn-lg" onClick={() => nav.go("courses", { create: true, at: Date.now() })}><Icon name="plus" size={16}/>Create a course</button>
            {sync?.status && !sync.status.enabled && (
              <button className="btn btn-lg" onClick={() => nav.go("settings")}>Sync from another computer</button>
            )}
          </div>
        </section>
      </div>
    );
  }

  // One mark per question today: answered ones first, then the rest grouped by course.
  const marks = [
    ...Array.from({ length: plan.done }, () => null),
    ...plan.byCourse.flatMap(b => Array.from({ length: b.count }, () => ix.course[b.courseId]?.color || "var(--ink-3)")),
  ];
  const note = planNote(plan);

  const waiting = [
    flagged > 0 && { key: "fix", icon: "flag", text: `${plural(flagged, "question")} out of your sessions until fixed`, action: "Review", go: () => setFixing(true) },
    inbox > 0 && { key: "notes", icon: "note", text: `${plural(inbox, "note")} in your inbox`, action: "Process", go: () => nav.go("notes") },
    recallDue > 0 && { key: "recall", icon: "shelf", text: `${plural(recallDue, "book")} to recall from your shelf`, action: "Recall", go: () => nav.go("shelf", { recall: true, at: Date.now() }) },
  ].filter(Boolean);

  return (
    <div className="page today">
      {head}

      <section className="today-main">
        {left > 0 ? (
          <div className="today-count">
            <span className="today-num">{left}</span>
            <span className="today-unit">{left === 1 ? "question" : "questions"}{plan.done > 0 ? " left" : ""}</span>
          </div>
        ) : (
          <div className="today-title">
            {finished ? "Done for today" : state.items.length ? "Nothing to study right now" : "No questions yet"}
          </div>
        )}

        {marks.length > 0 && (
          <div className="today-marks" aria-label={`${plan.done} of ${marks.length} answered`} role="img">
            {marks.map((c, i) => <span key={i} className={`mark${c ? "" : " done"}`} style={{ "--c": c || undefined, "--i": i }}/>)}
          </div>
        )}

        {left > 0 && (
          <ul className="today-courses">
            {plan.byCourse.map(b => (
              <li key={b.courseId}>
                <span className="dot" style={{ background: ix.course[b.courseId]?.color }}/>
                <span className="grow ell">{ix.course[b.courseId]?.name}</span>
                {b.fresh > 0 && <span className="today-new">{b.fresh} new</span>}
                <span className="today-n">{b.count}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="today-foot">
          {left > 0 && (
            <button className="btn btn-primary btn-lg" onClick={() => start()}>
              <Icon name="play" size={13}/>{plan.done > 0 ? "Continue" : "Start"}
            </button>
          )}
          {finished && more > 0 && (
            <button className="btn btn-lg" onClick={keepGoing}><Icon name="plus" size={15}/>{Math.min(EXTRA, more)} more</button>
          )}
          {!state.items.length && (
            <button className="btn btn-primary btn-lg" onClick={() => nav.go("courses")}><Icon name="plus" size={15}/>Add material</button>
          )}
          {plan.done > 0 && <span className="today-done">{plan.done} of {plan.done + left} answered</span>}
        </div>

        {(note || finished) && (
          <p className="today-note">
            {!finished ? note : plan.deferred ? `${plural(plan.deferred, "review is", "reviews are")} still due; ${plan.deferred === 1 ? "it comes" : "they come"} first tomorrow.` : `Your next ${plan.perDay} are ready tomorrow.`}
          </p>
        )}
      </section>

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
