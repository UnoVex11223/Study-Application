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
          onKeyDown={e => e.key === "Enter" && save()} placeholder="e.g. C Programming: A Modern Approach"/>
        <span className="help">One course per book, class or subject. You'll add chapters to it as you go.</span>
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
          <div className="page-sub">Everything you're learning. Pause or maintain a course to control how much of your daily time it gets.</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => nav.go("book")}><Icon name="book" size={15}/>Import a book</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={16}/>New course</button>
        </div>
      </div>

      {courses.length === 0 ? (
        <div className="panel empty">
          <h3>No courses yet</h3>
          <p>Create one for each book, class or subject you're working through, or import a whole book from its PDF.</p>
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
              <button key={c.id} className="course-row" onClick={() => nav.go("course", { courseId: c.id })} style={{ opacity: c.status === "paused" ? 0.65 : 1 }}>
                <span className="course-swatch" style={{ background: c.color }}/>
                <div style={{ minWidth: 0 }}>
                  <div className="course-name">{c.name}</div>
                  <div className="list-meta">
                    {COURSE_STATUS[c.status].label}. {m.total} concept{m.total === 1 ? "" : "s"}{m.due ? `, ${m.due} due` : ""}{m.slipping ? `, ${m.slipping} slipping` : ""}
                  </div>
                </div>
                <div>
                  <div className="course-cell-label">Mastered {pct(m.masteryPct)}</div>
                  <Bar value={m.masteryPct} tone="good"/>
                </div>
                <div>
                  <div className="course-cell-label">Started {pct(m.coveragePct)}</div>
                  <Bar value={m.coveragePct} thin/>
                </div>
                <div>
                  <div className="course-cell-label">Memory</div>
                  <div className="num">{m.memory == null ? "–" : pct(m.memory)}</div>
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
