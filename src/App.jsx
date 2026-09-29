import { useEffect, useMemo, useState } from "react";
import { StoreProvider, useStore } from "./state/store.jsx";
import { NavCtx } from "./ui/nav.js";
import Icon from "./ui/Icon.jsx";
import { Logo, Bar } from "./ui/ui.jsx";
import { BookImportProvider, jobProgress } from "./state/bookImport.jsx";
import { BackgroundProvider, useBackground } from "./state/background.jsx";
import { SyncProvider, useSync } from "./state/sync.jsx";
import ImportBook from "./views/ImportBook.jsx";
import Notes from "./views/Notes.jsx";
import Shelf from "./views/Shelf.jsx";
import { useKey } from "./ui/nav.js";
import { buildPlan } from "./lib/planner.js";
import Today from "./views/Today.jsx";
import Courses from "./views/Courses.jsx";
import Course from "./views/Course.jsx";
import AddMaterial from "./views/AddMaterial.jsx";
import KnowledgeMap from "./views/KnowledgeMap.jsx";
import Progress from "./views/Progress.jsx";
import Settings from "./views/Settings.jsx";
import TeachBack from "./views/TeachBack.jsx";
import Session from "./views/Session.jsx";

// Studying first, then looking back; the shelf sits at the bottom with Settings.
const NAV_GROUPS = [
  [
    { id: "today", label: "Today", icon: "today" },
    { id: "courses", label: "Courses", icon: "courses" },
    { id: "notes", label: "Notes", icon: "note" },
  ],
  [
    { id: "progress", label: "Progress", icon: "progress" },
    { id: "map", label: "Knowledge map", icon: "map" },
  ],
];
const NAV_BOTTOM = [
  { id: "shelf", label: "Shelf", icon: "shelf" },
  { id: "settings", label: "Settings", icon: "settings" },
];

/** Re-render every `ms` so time-based views (due counts, plans) stay current. */
function useNow(ms = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function Shell() {
  const { state } = useStore();
  const bg = useBackground();
  const sync = useSync();
  const [route, setRoute] = useState({ view: "today" });
  const [session, setSession] = useState(null);
  const now = useNow();

  useEffect(() => {
    if (!state) return;
    const root = document.documentElement;
    if (state.settings.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = state.settings.theme;
  }, [state]);

  const plan = useMemo(() => (state ? buildPlan(state, { now }) : null), [state, now]);
  const inboxCount = state ? state.notes.filter(n => n.status === "inbox").length : 0;
  // Ctrl+Shift+N: capture a note from anywhere.
  useKey((e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "N" || e.key === "n")) {
      e.preventDefault();
      setSession(null);
      setRoute({ view: "notes", capture: Date.now() });
    }
  }, []);

  const nav = useMemo(() => ({
    route,
    go: (view, params = {}) => { setRoute({ view, ...params }); document.querySelector(".main")?.scrollTo(0, 0); },
    startSession: (opts) => setSession({ key: Date.now(), ...opts }),
    endSession: () => setSession(null),
    now,
  }), [route, now]);

  if (!state) return <div className="app-loading"/>;

  const routeCourse = route.courseId ? state.courses.find(c => c.id === route.courseId) : null;
  const active = routeCourse?.kind === "notes" ? "notes" : ["course", "import", "teach", "book"].includes(route.view) ? "courses" : route.view;

  let page;
  switch (route.view) {
    case "courses": page = <Courses/>; break;
    case "course": page = state.courses.find(c => c.id === route.courseId)?.kind === "notes"
      ? <Notes/> : <Course courseId={route.courseId} key={route.courseId}/>; break;
    case "notes": page = <Notes/>; break;
    case "shelf": page = <Shelf/>; break;
    case "import": page = <AddMaterial courseId={route.courseId}/>; break;
    case "book": page = <ImportBook courseId={route.courseId}/>; break;
    case "teach": page = <TeachBack courseId={route.courseId} sectionId={route.sectionId}/>; break;
    case "map": page = <KnowledgeMap focusCourseId={route.courseId} focusConceptId={route.conceptId}/>; break;
    case "progress": page = <Progress/>; break;
    case "settings": page = <Settings/>; break;
    default: page = <Today plan={plan}/>;
  }

  return (
    <NavCtx.Provider value={nav}>
      <div className="app">
        <nav className="sidebar" aria-label="Main">
          <div className="brand"><Logo/>tenax</div>
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} className="nav-group">
              {group.map(n => (
                <button key={n.id} className={`nav-item${active === n.id ? " on" : ""}`} onClick={() => nav.go(n.id)}>
                  <Icon name={n.icon}/>{n.label}
                  {n.id === "today" && plan?.tasks.length > 0 && <span className="nav-count">{plan.tasks.length}</span>}
                  {n.id === "notes" && inboxCount > 0 && <span className="nav-count" title="Notes waiting to be processed">{inboxCount}</span>}
                </button>
              ))}
            </div>
          ))}
          {state.bookJobs.filter(j => j.status !== "done").map(j => {
            const p = jobProgress(j);
            const elsewhere = j.deviceId && sync?.device && j.deviceId !== sync.device.id;
            return (
              <button key={j.id} className="nav-job" onClick={() => nav.go("course", { courseId: j.courseId })} title={j.error || ""}>
                <span className="nav-job-title"><Icon name="book" size={13}/><span className="ell">{j.title}</span></span>
                <Bar value={p.total ? p.done / p.total : 0} thin/>
                <span className="nav-job-meta">{j.status === "paused" ? "Paused" : elsewhere ? `Importing on ${j.deviceName || "another computer"}` : "Importing"} · {p.done}/{p.total}</span>
              </button>
            );
          })}
          {bg.tasks.filter(t => t.status === "running").map(t => (
            <button key={t.id} className="nav-job" onClick={() => nav.go("course", { courseId: t.courseId })}>
              <span className="nav-job-title"><Icon name="sparkle" size={13}/><span className="ell">More questions: {t.label}</span></span>
              <Bar value={t.total ? t.done / t.total : 0} thin/>
              <span className="nav-job-meta">{t.added} added</span>
            </button>
          ))}
          <div className="nav-spacer"/>
          <div className="nav-group">
            {NAV_BOTTOM.map(n => (
              <button key={n.id} className={`nav-item${active === n.id ? " on" : ""}`} onClick={() => nav.go(n.id)}>
                <Icon name={n.icon}/>{n.label}
              </button>
            ))}
          </div>
        </nav>
        <main className="main">{page}</main>
      </div>
      {session && <Session key={session.key} {...session}/>}
    </NavCtx.Provider>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <SyncProvider>
        <BookImportProvider>
          <BackgroundProvider><Shell/></BackgroundProvider>
        </BookImportProvider>
      </SyncProvider>
    </StoreProvider>
  );
}
