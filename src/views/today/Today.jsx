// Today: the same number of questions every day. The page shows how many are
// left as one big number and a row of marks, one per question (filled as you
// answer them, coloured by course until then), which courses they come from,
// and a button to start. Under it, only the things waiting on you: questions
// to fix, notes to process, books to recall. No time estimates: how long you
// study is up to you.

import { useMemo, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useSync } from "../../state/sync.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page } from "../../ui/layout.jsx";
import { CourseDot } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { buildPlan } from "../../lib/planner.js";
import { dueForRecall } from "../../lib/recall.js";
import { index, courseInk } from "../../lib/model.js";
import { plural, pluralWord, dayDate } from "../../lib/format.js";
import FixPanel from "./FixPanel.jsx";

const EXTRA = 5; // "5 more" after the day's questions are done

/** The day's plan with room for EXTRA more questions. */
const withExtra = (state, day) => ({
  ...state, days: { ...state.days, [day]: { ...state.days?.[day], extra: (state.days?.[day]?.extra || 0) + EXTRA } },
});

/** One short line about the day, only when there's something worth knowing. */
function planNote(plan, finished) {
  if (finished) {
    return plan.deferred
      ? `${plural(plan.deferred, "review is", "reviews are")} still due; ${pluralWord(plan.deferred, "it's", "they're")} in tomorrow's ${plan.perDay}.`
      : `Your next ${plan.perDay} are ready tomorrow.`;
  }
  if (plan.short && plan.tasks.length) return `That's everything due or ready to start right now. Add material to fill your ${plan.perDay}.`;
  if (plan.slipping) return `${plural(plan.slipping, "review that's starting to slip", "reviews that are starting to slip")} didn't fit; ${pluralWord(plan.slipping, "it comes", "they come")} first tomorrow.`;
  if (plan.deferred) return `${plural(plan.deferred, "review you still know well waits", "reviews you still know well wait")} a day, so every course gets its turn.`;
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

  const left = plan.tasks.length;
  const finished = left === 0 && plan.done > 0;
  // After the day's questions: is there anything worth asking if you want a few more?
  const more = useMemo(
    () => (finished ? buildPlan(withExtra(state, plan.today), { now }).tasks.length : 0),
    [finished, state, plan.today, now],
  );

  const start = (tasks = plan.tasks) => nav.startSession({ tasks, mode: "session", daily: true });
  const keepGoing = () => {
    const next = buildPlan(withExtra(state, plan.today), { now });
    act("day/extra", { count: EXTRA });
    if (next.tasks.length) start(next.tasks);
  };

  if (!state.courses.length) {
    return (
      <Page width="narrow" className="today">
        <section className="today-main">
          <h1 className="today-date">{dayDate(now)}</h1>
          <p className="today-title">Add what you're studying</p>
          <div className="today-foot">
            <button className="btn btn-primary btn-lg" onClick={() => nav.go("courses", { create: true, at: Date.now() })}><Icon name="plus"/>Create a course</button>
            {sync?.status && !sync.status.enabled && (
              <button className="btn btn-lg" onClick={() => nav.go("settings")}>Sync from another computer</button>
            )}
          </div>
        </section>
      </Page>
    );
  }

  // One mark per question today: answered ones first, then the rest grouped by course.
  const marks = [
    ...Array.from({ length: plan.done }, () => null),
    ...plan.byCourse.flatMap(b => Array.from({ length: b.count }, () => courseInk(ix.course[b.courseId]?.color))),
  ];
  const note = planNote(plan, finished);
  const flagged = state.items.filter(i => i.flag).length;
  const inbox = state.notes.filter(n => n.status === "inbox").length;
  const recallDue = dueForRecall(state.shelf, now).length;
  const waiting = [
    flagged > 0 && { key: "fix", icon: "flag", text: `${plural(flagged, "question")} out of your sessions until fixed`, action: "Review", go: () => setFixing(true) },
    inbox > 0 && { key: "notes", icon: "note", text: `${plural(inbox, "note")} in your inbox`, action: "Process", go: () => nav.go("notes") },
    recallDue > 0 && { key: "recall", icon: "shelf", text: `${plural(recallDue, "book")} to recall from your shelf`, action: "Recall", go: () => nav.go("shelf", { recall: true, at: Date.now() }) },
  ].filter(Boolean);

  return (
    <Page width="narrow" className="today">
      <section className="today-main">
        <h1 className="today-date">{dayDate(now)}</h1>

        {left > 0 ? (
          <div className="today-count">
            <span className="today-num">{left}</span>
            <span className="today-unit">{pluralWord(left, "question")}{plan.done > 0 ? " left" : ""}</span>
          </div>
        ) : (
          <p className="today-title">{finished ? "Done for today" : state.items.length ? "Nothing to study right now" : "No questions yet"}</p>
        )}

        {marks.length > 0 && (
          <div className="today-marks" role="img" aria-label={`${plan.done} of ${marks.length} answered`}>
            {marks.map((c, i) => <span key={i} className={cx("mark", !c && "done")} style={{ "--c": c || undefined, "--i": i }}/>)}
          </div>
        )}

        {left > 0 && (
          <ul className="today-courses">
            {plan.byCourse.map(b => (
              <li key={b.courseId}>
                <CourseDot color={ix.course[b.courseId]?.color}/>
                <span className="grow ell">{ix.course[b.courseId]?.name}</span>
                {b.fresh > 0 && <span className="today-new">{b.fresh} new</span>}
                <span className="today-n num">{b.count}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="today-foot">
          {left > 0 && (
            <button className="btn btn-primary btn-lg" onClick={() => start()}>
              <Icon name="play"/>{plan.done > 0 ? "Continue" : "Start"}
            </button>
          )}
          {finished && more > 0 && <button className="btn btn-lg" onClick={keepGoing}><Icon name="plus"/>{Math.min(EXTRA, more)} more</button>}
          {!state.items.length && <button className="btn btn-primary btn-lg" onClick={() => nav.go("courses")}><Icon name="plus"/>Add material</button>}
          {plan.done > 0 && <span className="today-done num">{plan.done} of {plan.done + left} answered</span>}
        </div>

        {note && <p className="today-note">{note}</p>}
      </section>

      {waiting.length > 0 && (
        <div className="list">
          {waiting.map(w => (
            <button key={w.key} className="list-row" onClick={w.go}>
              <Icon name={w.icon}/>
              <span className="grow">{w.text}</span>
              <span className="list-action">{w.action}<Icon name="chevron"/></span>
            </button>
          ))}
        </div>
      )}

      {fixing && <FixPanel onClose={() => setFixing(false)}/>}
    </Page>
  );
}
