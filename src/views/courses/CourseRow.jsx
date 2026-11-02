// One course in a list (Courses, and the areas on Notes): its colour and name,
// a line of facts, and how much is mastered, started and remembered.
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import { Bar } from "../../ui/display.jsx";
import { cx } from "../../ui/cx.js";
import { COURSE_STATUS, courseInk } from "../../lib/model.js";
import { courseMastery } from "../../lib/mastery.js";
import { plural, pct } from "../../lib/format.js";

/** A labelled share with a bar under it. */
function Metric({ label, value, tone }) {
  return (
    <div className="course-metric">
      <div className="course-metric-label"><span>{label}</span><span className="num">{value == null ? "–" : pct(value)}</span></div>
      <Bar value={value ?? 0} tone={tone} thin/>
    </div>
  );
}

/** `note` leads the line of facts (e.g. "From your notes"). */
export default function CourseRow({ course: c, note }) {
  const { state } = useStore();
  const nav = useNav();
  const m = courseMastery(state, c.id, nav.now);
  return (
    <button className={cx("list-row course-row", c.status === "paused" && "paused")} onClick={() => nav.go("course", { courseId: c.id })}>
      <span className="course-swatch" style={{ "--c": courseInk(c.color) }}/>
      <span className="course-main">
        <span className="course-name">{c.name}</span>
        <span className="meta">
          {note && <span>{note}</span>}
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
}
