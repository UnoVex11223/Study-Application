// The sidebar: the pages, with a count beside the ones waiting on you, and
// any work running in the background (book imports, more questions).
import { useStore } from "../state/store.jsx";
import { useSync } from "../state/sync.jsx";
import { useBackground } from "../state/background.jsx";
import { jobProgress } from "../state/bookImport.jsx";
import { useNav } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import { Bar } from "../ui/display.jsx";
import { cx } from "../ui/cx.js";

// Studying first, then looking back, then the shelf; Settings sits at the bottom.
const NAV_GROUPS = [
  [
    { id: "today", label: "Today", icon: "today", count: "today", hint: "Questions left today" },
    { id: "courses", label: "Courses", icon: "courses" },
    { id: "notes", label: "Notes", icon: "note", count: "notes", hint: "Notes waiting to be processed" },
  ],
  [
    { id: "progress", label: "Progress", icon: "progress" },
    { id: "map", label: "Knowledge map", icon: "map" },
  ],
  [
    { id: "shelf", label: "Shelf", icon: "shelf", count: "shelf", hint: "Books to recall" },
  ],
];
const SETTINGS = { id: "settings", label: "Settings", icon: "settings" };

/** active: the lit item's id. counts: { today, notes, shelf } (0 hides the count). */
export default function Sidebar({ active, counts }) {
  const nav = useNav();
  const item = (n) => (
    <button key={n.id} className={cx("nav-item", active === n.id && "on")} onClick={() => nav.go(n.id)}>
      {/* The highlight slides to the item you pick (styles/motion.css, nav-pill). */}
      {active === n.id && <span className="nav-pill" aria-hidden="true"/>}
      <span className="nav-inner" style={{ viewTransitionName: `nav-${n.id}` }}>
        <Icon name={n.icon}/>{n.label}
        {counts[n.count] > 0 && <span className="nav-count num" title={n.hint}>{counts[n.count]}</span>}
      </span>
    </button>
  );
  return (
    <nav className="sidebar" aria-label="Main">
      {NAV_GROUPS.map((group, i) => <div key={i} className="nav-group">{group.map(item)}</div>)}
      <BackgroundWork/>
      <div className="nav-spacer"/>
      <div className="nav-group">{item(SETTINGS)}</div>
    </nav>
  );
}

/** A card for each book being imported and each batch of questions being written. */
function BackgroundWork() {
  const { state } = useStore();
  const nav = useNav();
  const sync = useSync();
  const bg = useBackground();
  const imports = state.bookJobs.filter(j => j.status !== "done");
  const topUps = bg.tasks.filter(t => t.status === "running");
  return (
    <>
      {imports.map(j => {
        const p = jobProgress(j);
        const elsewhere = j.deviceId && sync?.device && j.deviceId !== sync.device.id;
        const what = j.status === "paused" ? "Paused" : elsewhere ? `Importing on ${j.deviceName || "another computer"}` : "Importing";
        return (
          <button key={j.id} className="nav-job" onClick={() => nav.go("course", { courseId: j.courseId })} title={j.error || ""}>
            <span className="nav-job-title"><Icon name="book"/><span className="ell">{j.title}</span></span>
            <Bar value={p.total ? p.done / p.total : 0} thin/>
            <span className="nav-job-meta num">{what}, {p.done} of {p.total} chapters</span>
          </button>
        );
      })}
      {topUps.map(t => (
        <button key={t.id} className="nav-job" onClick={() => nav.go("course", { courseId: t.courseId })}>
          <span className="nav-job-title"><Icon name="sparkle"/><span className="ell">More questions: {t.label}</span></span>
          <Bar value={t.total ? t.done / t.total : 0} thin/>
          <span className="nav-job-meta num">{t.added} added</span>
        </button>
      ))}
    </>
  );
}
