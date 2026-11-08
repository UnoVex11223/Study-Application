// One course in a list (Courses, and the areas on Notes): its colour, its
// name, and how much of it is mastered. Nothing else, unless it's paused or
// maintaining (or `note` says where it came from).
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import { Bar } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { COURSE_STATUS, courseInk } from "../../lib/model.js";
import { courseMastery } from "../../lib/mastery.js";
import { pct } from "../../lib/format.js";

export default function CourseRow({ course: c, note }) {
  const { state } = useStore();
  const nav = useNav();
  const m = courseMastery(state, c.id, nav.now);
  const facts = [note, c.status !== "active" ? COURSE_STATUS[c.status].label : null].filter(Boolean);
  return (
    <button className={cx("list-row course-row", c.status === "paused" && "paused")} onClick={() => nav.go("course", { courseId: c.id })}>
      <span className="course-swatch" style={{ "--c": courseInk(c.color) }}/>
      <span className="course-main">
        <span className="course-name">{c.name}</span>
        {facts.length > 0 && <span className="meta">{facts.map(f => <span key={f}>{f}</span>)}</span>}
      </span>
      <div className="course-metric">
        <div className="course-metric-label"><span>Mastered</span><span className="num">{pct(m.masteryPct ?? 0)}</span></div>
        <Bar value={m.masteryPct ?? 0} tone="good" thin/>
      </div>
    </button>
  );
}
