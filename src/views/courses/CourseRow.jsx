// One course in a list (Courses, and the areas on Notes): its name and how
// much of it is mastered. Nothing else, unless it's paused or maintaining (or
// `note` says where it came from).
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import { cx } from "../../ui/cx.js";
import { COURSE_STATUS } from "../../lib/model.js";
import { courseMastery } from "../../lib/mastery.js";
import { pct } from "../../lib/format.js";

export default function CourseRow({ course: c, note }) {
  const { state } = useStore();
  const nav = useNav();
  const m = courseMastery(state, c.id, nav.now);
  const facts = [note, c.status !== "active" ? COURSE_STATUS[c.status].label : null].filter(Boolean);
  return (
    <button className={cx("list-row course-row", c.status === "paused" && "paused")} onClick={() => nav.go("course", { courseId: c.id })}>
      <span className="course-main">
        <span className="course-name">{c.name}</span>
        {facts.length > 0 && <span className="meta">{facts.map(f => <span key={f}>{f}</span>)}</span>}
      </span>
      <span className="course-pct num">{pct(m.masteryPct ?? 0)} mastered</span>
    </button>
  );
}
