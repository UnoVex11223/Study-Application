import { useState } from "react";
import { useStore } from "../state/store.jsx";
import { Bar, Modal } from "../ui/ui.jsx";
import { useNav, pct } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import { makeCourse, COURSE_STATUS, COURSE_COLORS } from "../lib/model.js";
import { courseMastery } from "../lib/mastery.js";

export function CourseForm({ course, onSave, onClose }) {
  const [name, setName] = useState(course?.name ?? "");
  const [color, setColor] = useState(course?.color ?? null);
  const save = () => { if (name.trim()) onSave({ name: name.trim(), ...(color ? { color } : {}) }); };
  return (
    <Modal title={course ? "Edit course" : "New course"} onClose={onClose}
      footer={<>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>{course ? "Save changes" : "Create course"}</button>
      </>}>
      <div className="field">
        <label htmlFor="course-name">Name</label>
        <input id="course-name" className="input" value={name} autoFocus onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && save()}/>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <span className="label">Color</span>
        <div className="row">
          {COURSE_COLORS.map(c => (
            <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => setColor(c)}
              style={{ width: 24, height: 24, borderRadius: 6, background: c, border: 0, cursor: "pointer", boxShadow: (color ?? course?.color) === c ? "0 0 0 2px var(--surface), 0 0 0 4px var(--ink)" : "none" }}/>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default function Courses() {
  const { state, act } = useStore();
  const nav = useNav();
  const [creating, setCreating] = useState(Boolean(nav.route.create));
  const now = nav.now;

  const create = (fields) => {
    const course = makeCourse(fields, state.courses.length);
    act("course/add", { course });
    setCreating(false);
    nav.go("course", { courseId: course.id, fresh: true });
  };

  const order = { active: 0, maintain: 1, paused: 2 };
  const courses = state.courses.filter(c => c.kind !== "notes").sort((a, b) => order[a.status] - order[b.status] || a.createdAt - b.createdAt);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Courses</h1>
        </div>
        <div className="row">
          <button className="btn" onClick={() => nav.go("book")}><Icon name="book" size={15}/>Import a book</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={16}/>New course</button>
        </div>
      </div>

      {courses.length === 0 ? (
        <div className="panel empty">
          <h3>No courses yet</h3>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => nav.go("book")}><Icon name="book" size={15}/>Import a book</button>
            <button className="btn" onClick={() => setCreating(true)}><Icon name="plus" size={16}/>New course</button>
          </div>
        </div>
      ) : (
        <div className="panel list">
          {courses.map(c => {
            const m = courseMastery(state, c.id, now);
            return (
              <button key={c.id} className={`course-row${c.status === "paused" ? " paused" : ""}`} onClick={() => nav.go("course", { courseId: c.id })}>
                <span className="course-swatch" style={{ background: c.color }}/>
                <div style={{ minWidth: 0 }}>
                  <div className="course-name">{c.name}</div>
                  <div className="section-stats">
                    {c.status !== "active" && <span>{COURSE_STATUS[c.status].label}</span>}
                    <span>{m.total} concept{m.total === 1 ? "" : "s"}</span>
                    {m.locked > 0 && <span>{m.locked} in unread chapters</span>}
                    {m.due > 0 && <span>{m.due} due</span>}
                    {m.slipping > 0 && <span className="warn">{m.slipping} slipping</span>}
                  </div>
                </div>
                <div className="course-cell">
                  <div className="course-cell-label"><span>Mastered</span><span className="num">{pct(m.masteryPct)}</span></div>
                  <Bar value={m.masteryPct} tone="good" thin/>
                </div>
                <div className="course-cell">
                  <div className="course-cell-label"><span>Started</span><span className="num">{pct(m.coveragePct)}</span></div>
                  <Bar value={m.coveragePct} thin/>
                </div>
                <div className="course-cell">
                  <div className="course-cell-label"><span>Recall</span><span className="num">{m.memory == null ? "–" : pct(m.memory)}</span></div>
                  <Bar value={m.memory ?? 0} thin/>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {creating && <CourseForm onSave={create} onClose={() => setCreating(false)}/>}
    </div>
  );
}
