// Courses: every course you study, active ones first, with how much is
// mastered, started and remembered.
import { useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import Icon from "../../ui/Icon.jsx";
import { Page, PageHeader, EmptyState } from "../../ui/layout.jsx";
import { Bar } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { makeCourse, COURSE_STATUS, courseInk } from "../../lib/model.js";
import { courseMastery } from "../../lib/mastery.js";
import { plural, pct } from "../../lib/format.js";
import CourseForm from "./CourseForm.jsx";

const STATUS_ORDER = { active: 0, maintain: 1, paused: 2 };

/** A labelled share with a bar under it. */
function Metric({ label, value, tone }) {
  return (
    <div className="course-metric">
      <div className="course-metric-label"><span>{label}</span><span className="num">{value == null ? "–" : pct(value)}</span></div>
      <Bar value={value ?? 0} tone={tone} thin/>
    </div>
  );
}

export default function Courses() {
  const { state, act } = useStore();
  const nav = useNav();
  const [creating, setCreating] = useState(Boolean(nav.route.create));

  const create = (fields) => {
    const course = makeCourse(fields, state.courses.length);
    act("course/add", { course });
    setCreating(false);
    nav.go("course", { courseId: course.id, fresh: true });
  };

  const courses = state.courses
    .filter(c => c.kind !== "notes")
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.createdAt - b.createdAt);
  const importBook = <button className="btn" onClick={() => nav.go("book")}><Icon name="book"/>Import a book</button>;
  const newCourse = <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus"/>New course</button>;

  return (
    <Page>
      <PageHeader title="Courses" actions={<>{importBook}{newCourse}</>}/>

      {courses.length === 0 ? (
        <EmptyState title="No courses yet" actions={<>{importBook}{newCourse}</>}>
          A course is a book, class or subject. Import a book's PDF, or start a course and add its chapters as you go.
        </EmptyState>
      ) : (
        <div className="list">
          {courses.map(c => {
            const m = courseMastery(state, c.id, nav.now);
            return (
              <button key={c.id} className={cx("list-row course-row", c.status === "paused" && "paused")} onClick={() => nav.go("course", { courseId: c.id })}>
                <span className="course-swatch" style={{ "--c": courseInk(c.color) }}/>
                <span className="course-main">
                  <span className="course-name">{c.name}</span>
                  <span className="meta">
                    {c.status !== "active" && <span>{COURSE_STATUS[c.status].label}</span>}
                    <span>{plural(m.total, "concept")}</span>
                    {m.locked > 0 && <span>{m.locked} in unread chapters</span>}
                    {m.due > 0 && <span>{m.due} due</span>}
                    {m.slipping > 0 && <span className="warn">{m.slipping} slipping</span>}
                  </span>
                </span>
                <Metric label="Mastered" value={m.masteryPct} tone="good"/>
                <Metric label="Started" value={m.coveragePct}/>
                <Metric label="Recall" value={m.memory}/>
              </button>
            );
          })}
        </div>
      )}
      {creating && <CourseForm onSave={create} onClose={() => setCreating(false)}/>}
    </Page>
  );
}
