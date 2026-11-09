// Today: the day's questions as a row of marks, one per question (filled as
// you answer them, coloured by course until then), the courses they come
// from, and a button to start. Under it, the mastery test when one is due
// (lib/masteryTest.js) and your level. Nothing else to read: how long you
// study is up to you.

import { useMemo, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useSync } from "../../state/sync.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page, PageHeader, EmptyState } from "../../ui/layout.jsx";
import { CourseDot } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { buildPlan } from "../../lib/planner.js";
import { index, courseInk } from "../../lib/model.js";
import { dayDate, shortDate } from "../../lib/format.js";
import { testStatus, testTasks, TEST_SIZE } from "../../lib/masteryTest.js";
import { totalXp } from "../../lib/xp.js";
import { LevelLine } from "../../ui/Level.jsx";
import FixPanel from "./FixPanel.jsx";

const EXTRA = 5; // "5 more" after the day's questions are done

/** The day's plan with room for EXTRA more questions. */
const withExtra = (state, day) => ({
  ...state, days: { ...state.days, [day]: { ...state.days?.[day], extra: (state.days?.[day]?.extra || 0) + EXTRA } },
});

export default function Today({ plan }) {
  const { state, act } = useStore();
  const sync = useSync();
  const nav = useNav();
  const ix = index(state);
  const now = nav.now;
  // Questions to fix open from the palette ("Fix reported questions").
  const [fixing, setFixing] = useState(Boolean(nav.route.fix));

  const left = plan.tasks.length;
  const finished = left === 0 && plan.done > 0;
  // After the day's questions: is there anything worth asking if you want a few more?
  const more = useMemo(
    () => (finished ? buildPlan(withExtra(state, plan.today), { now }).tasks.length : 0),
    [finished, state, plan.today, now],
  );

  const start = (tasks = plan.tasks) => nav.startSession({ tasks, mode: "session", daily: true });
  const test = useMemo(() => testStatus(state, now), [state, now]);
  const xp = useMemo(() => totalXp(state.attempts), [state.attempts]);
  const takeTest = () => nav.startSession({ tasks: testTasks(state, Date.now()), mode: "test", title: "Mastery test" });
  const keepGoing = () => {
    const next = buildPlan(withExtra(state, plan.today), { now });
    act("day/extra", { count: EXTRA });
    if (next.tasks.length) start(next.tasks);
  };

  if (!state.courses.length) {
    return (
      <Page width="narrow" className="today">
        <PageHeader title={dayDate(now)}/>
        <EmptyState title="Add what you're studying" actions={<>
          <button className="btn btn-primary" onClick={() => nav.go("new", { at: Date.now() })}><Icon name="plus"/>Create a course</button>
          {sync?.status && !sync.status.enabled && <button className="btn" onClick={() => nav.go("settings")}>Sync from another computer</button>}
        </>}>
          A course is a book, class or subject. Each day brings the same number of questions from everything you study.
        </EmptyState>
      </Page>
    );
  }

  // One mark per question today: answered ones first, then the rest grouped by course.
  const marks = [
    ...Array.from({ length: plan.done }, () => null),
    ...plan.byCourse.flatMap(b => Array.from({ length: b.count }, () => courseInk(ix.course[b.courseId]?.color))),
  ];
  let action = null;
  if (left > 0) action = <button className="btn btn-primary" onClick={() => start()}><Icon name="play"/>{plan.done > 0 ? "Continue" : "Start"}</button>;
  else if (finished && more > 0) action = <button className="btn" onClick={keepGoing}><Icon name="plus"/>{Math.min(EXTRA, more)} more</button>;
  else if (!state.items.length) action = <button className="btn btn-primary" onClick={() => nav.go("courses")}><Icon name="plus"/>Add material</button>;

  return (
    <Page width="narrow" className="today">
      <PageHeader title={dayDate(now)} actions={action}/>

      <section className="today-plan">
        {marks.length > 0 && (
          <div className="today-marks" role="img" aria-label={`${plan.done} of ${marks.length} answered`}>
            {marks.map((c, i) => <span key={i} className={cx("mark", !c && "done")} style={{ "--c": c || undefined, "--i": i }}/>)}
          </div>
        )}
        {left > 0 ? (
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
        ) : (
          <p className="today-status">{finished ? "Done for today." : state.items.length ? "Nothing to study right now." : "No questions yet."}</p>
        )}
      </section>

      {test.available && (
        <section className="today-test enter">
          <div className="grow">
            <div className="today-test-title">Mastery test</div>
            <div className="today-test-text">{TEST_SIZE} concepts are ready to be proven.</div>
          </div>
          <button className="btn" onClick={takeTest}>Take the test</button>
        </section>
      )}
      {!test.available && test.ready >= TEST_SIZE && test.nextAt && (
        <p className="today-next-test">Next mastery test {shortDate(test.nextAt)}</p>
      )}

      {state.attempts.length > 0 && <LevelLine xp={xp} className="today-level"/>}

      {fixing && <FixPanel onClose={() => setFixing(false)}/>}
    </Page>
  );
}
