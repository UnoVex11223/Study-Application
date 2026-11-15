// Today: the date, the day's questions as a row of marks, one per question
// (filled as you answer them), what to study (every course, or one of them:
// each choice says how many questions it brings, and choosing rebuilds the
// day's session from it), and under them the button that begins the session.
// Under it, the mastery test when one is due (lib/masteryTest.js). Nothing
// else to read: how long you study is up to you.

import { useMemo, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useSync } from "../../state/sync.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page, PageHeader, EmptyState } from "../../ui/layout.jsx";
import { cx } from "../../ui/cx.js";
import { buildPlan } from "../../lib/planner.js";
import { index, courseInk } from "../../lib/model.js";
import { dayDate, shortDate, plural, pluralWord } from "../../lib/format.js";
import { testStatus, testTasks, TEST_SIZE } from "../../lib/masteryTest.js";
import FixPanel from "./FixPanel.jsx";

const EXTRA = 5; // "5 more" after the day's questions are done
const STATUS_ORDER = { active: 0, maintain: 1 };

/**
 * What today's session can be built from: every course, or one of them, each
 * with the number of questions it would bring. Null when there's nothing to
 * choose between (fewer than two courses with questions that aren't paused).
 */
function studyChoices(state, plan, now) {
  const ix = index(state);
  const hasQuestions = (c) => (ix.conceptsByCourse[c.id] || []).some(k => (ix.itemsByConcept[k.id] || []).length > 0);
  const courses = state.courses
    .filter(c => c.status !== "paused" && hasQuestions(c))
    // The same order as the Courses page: active first, the areas notes made last.
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.kind === "notes") - (b.kind === "notes") || a.createdAt - b.createdAt);
  if (courses.length < 2) return null;
  const count = (id) => (id === plan.focus ? plan.tasks.length : buildPlan(state, { now, focus: id }).tasks.length);
  return [{ id: null, name: "All courses" }, ...courses.map(c => ({ id: c.id, name: c.name }))].map(o => ({ ...o, count: count(o.id) }));
}

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
  const choices = useMemo(() => studyChoices(state, plan, now), [state, plan, now]);
  // Done for the day: you've answered some and no choice has anything left
  // (one course running dry doesn't finish a day the others can still fill).
  const finished = plan.done > 0 && (choices ? choices.every(o => o.count === 0) : left === 0);
  // After the day's questions: is there anything worth asking if you want a few more?
  const more = useMemo(
    () => (finished ? buildPlan(withExtra(state, plan.today), { now }).tasks.length : 0),
    [finished, state, plan.today, now],
  );

  const start = (tasks = plan.tasks) => nav.startSession({ tasks, mode: "session", daily: true });
  // Your choice is kept (Settings) and the day's session is rebuilt from it at once.
  const choose = (id) => { if (id !== plan.focus) act("settings", { patch: { focusCourseId: id } }); };
  const test = useMemo(() => testStatus(state, now), [state, now]);
  const takeTest = () => nav.startSession({ tasks: testTasks(state, Date.now()), mode: "test", title: "Mastery test" });
  const keepGoing = () => {
    const next = buildPlan(withExtra(state, plan.today), { now });
    act("day/extra", { count: EXTRA });
    if (next.tasks.length) start(next.tasks);
  };

  if (!state.courses.length) {
    return (
      <Page width="narrow" className="today">
        <PageHeader center title={dayDate(now)}/>
        <EmptyState title="Add what you're studying" actions={<>
          <button className="btn btn-primary" onClick={() => nav.go("new", { at: Date.now() })}><Icon name="plus"/>Import course</button>
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
  if (left > 0) action = <button className="btn btn-primary btn-lg" onClick={() => start()}>{plan.done > 0 ? "Continue session" : "Begin session"}</button>;
  else if (finished && more > 0) action = <button className="btn btn-lg" onClick={keepGoing}>{Math.min(EXTRA, more)} more</button>;
  else if (!state.items.length) action = <button className="btn btn-primary btn-lg" onClick={() => nav.go("courses")}>Add material</button>;

  return (
    <Page width="narrow" className="today">
      <PageHeader center title={dayDate(now)}/>

      <section className="today-plan">
        {marks.length > 0 && (
          <div className="today-marks" role="img" aria-label={`${plan.done} of ${marks.length} answered`}>
            {marks.map((c, i) => <span key={i} className={cx("mark", !c && "done")} style={{ "--c": c || undefined, "--i": i }}/>)}
          </div>
        )}
        {choices && !finished ? (
          <div className="today-choices" role="radiogroup" aria-label="What to study today">
            {choices.map(o => (
              <button key={o.id ?? "all"} type="button" role="radio" aria-checked={o.id === plan.focus} className={cx("today-choice", o.id === plan.focus && "on")}
                title={`${plural(o.count, "question")} today`} onClick={() => choose(o.id)}>
                <span className="today-dot" aria-hidden="true"/>
                <span className="grow ell">{o.name}</span>
                <span className="today-n num">{o.count}</span>
              </button>
            ))}
          </div>
        ) : left > 0 && (
          <ul className="today-courses">
            {plan.byCourse.map(b => (
              <li key={b.courseId}>
                <span className="grow ell">{ix.course[b.courseId]?.name}</span>
                <span className="today-n num">{b.count}</span>
              </li>
            ))}
          </ul>
        )}
        {left === 0 && (
          <p className="today-status">
            {finished ? "Done for today."
              : plan.focus ? `Nothing to study in ${ix.course[plan.focus]?.name} today.`
              : state.items.length ? "Nothing to study right now." : "No questions yet."}
          </p>
        )}
        {action && <div className="today-action">{action}</div>}
        {plan.focus && plan.elsewhere > 0 && !finished && (
          <p className="today-note">{plural(plan.elsewhere, "review")} {pluralWord(plan.elsewhere, "is", "are")} due in your other courses.</p>
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

      {fixing && <FixPanel onClose={() => setFixing(false)}/>}
    </Page>
  );
}
