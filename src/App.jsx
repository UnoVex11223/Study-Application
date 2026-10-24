import { useEffect, useMemo, useState } from "react";
import { transition } from "./ui/motion.js";
import { setSounds } from "./ui/sound.js";
import Palette from "./ui/Palette.jsx";
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
import { dueForRecall } from "./lib/recall.js";
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

// Studying first, then looking back, then the shelf; Settings sits at the bottom.
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
  [
    { id: "shelf", label: "Shelf", icon: "shelf" },
  ],
];
const NAV_BOTTOM = [
  { id: "settings", label: "Settings", icon: "settings" },
];

// Counts page changes, so going to the page you're on starts it afresh (the Shelf's year view closes, say).
let navCount = 0;

/** Re-render every `ms` so time-based views (due counts, plans) stay current. */
function useNow(ms = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** The title bar: the Tenax mark, the search box (it opens the palette), and room for the window's own buttons. */
function TitleBar({ onSearch }) {
  const mac = window.tenax?.window?.platform === "darwin";
  return (
    <header className={`titlebar${mac ? " mac" : ""}`}>
      <div className="titlebar-brand"><Logo size={18}/>tenax</div>
      <button className="titlebar-search" onClick={onSearch}>
        <Icon name="search" size={14}/><span className="grow">Search</span><kbd>{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <div className="titlebar-end"/>
    </header>
  );
}

/** The theme on the page, and the same colours on the window's title bar buttons. */
function useTheme(theme) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    const paint = () => {
      const css = getComputedStyle(root);
      window.tenax?.window?.chrome?.({ color: css.getPropertyValue("--chrome").trim(), symbolColor: css.getPropertyValue("--ink-2").trim() });
    };
    paint();
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    media?.addEventListener?.("change", paint);
    return () => media?.removeEventListener?.("change", paint);
  }, [theme]);
}

function Shell() {
  const { state } = useStore();
  const bg = useBackground();
  const sync = useSync();
  const [route, setRoute] = useState({ view: "today" });
  const [session, setSession] = useState(null);
  const [palette, setPalette] = useState(false);
  const now = useNow();

  useTheme(state?.settings.theme ?? "dark");
  useEffect(() => { setSounds(state?.settings.sounds); }, [state?.settings.sounds]);

  const plan = useMemo(() => (state ? buildPlan(state, { now }) : null), [state, now]);
  const inboxCount = state ? state.notes.filter(n => n.status === "inbox").length : 0;
  const recallCount = state ? dueForRecall(state.shelf, now).length : 0;
  // Ctrl+Shift+N: capture a note from anywhere. Ctrl+K: the palette (not during a session).
  useKey((e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && (e.key === "N" || e.key === "n")) {
      e.preventDefault();
      transition(() => { setSession(null); setRoute({ view: "notes", capture: Date.now() }); });
    } else if (mod && !e.shiftKey && (e.key === "k" || e.key === "K") && !session) {
      e.preventDefault();
      setPalette(p => !p);
    }
  }, [session]);

  const nav = useMemo(() => ({
    route,
    // Every page change is a view transition (ui/motion.js); `type` picks how it moves.
    go: (view, params = {}, { type = "page" } = {}) => transition(() => {
      setRoute({ view, ...params, n: (navCount += 1) });
      document.querySelector(".main")?.scrollTo(0, 0);
    }, type),
    startSession: (opts) => transition(() => setSession({ key: Date.now(), ...opts }), "session"),
    endSession: () => transition(() => setSession(null), "session"),
    now,
  }), [route, now]);

  if (!state) return <div className="app-loading"/>;

  const routeCourse = route.courseId ? state.courses.find(c => c.id === route.courseId) : null;
  const active = routeCourse?.kind === "notes" ? "notes" : ["course", "import", "teach", "book"].includes(route.view) ? "courses" : route.view;

  let page;
  switch (route.view) {
    case "courses": page = <Courses key={route.at ?? "courses"}/>; break;
    case "course": page = state.courses.find(c => c.id === route.courseId)?.kind === "notes"
      ? <Notes key={route.at ?? "notes"}/> : <Course courseId={route.courseId} key={`${route.courseId}-${route.at ?? ""}`}/>; break;
    case "notes": page = <Notes/>; break;
    case "shelf": page = <Shelf key={`${route.recall ? "recall" : "shelf"}-${route.at ?? route.open ?? route.add ?? route.n ?? ""}`} recall={Boolean(route.recall)} openItem={route.open} adding={Boolean(route.add)} year={route.year ?? null}/>; break;
    case "import": page = <AddMaterial courseId={route.courseId}/>; break;
    case "book": page = <ImportBook courseId={route.courseId} key={route.at ?? "book"}/>; break;
    case "teach": page = <TeachBack courseId={route.courseId} sectionId={route.sectionId}/>; break;
    case "map": page = <KnowledgeMap focusCourseId={route.courseId} focusConceptId={route.conceptId}/>; break;
    case "progress": page = <Progress/>; break;
    case "settings": page = <Settings/>; break;
    default: page = <Today plan={plan} key={route.fix ?? "today"}/>;
  }

  // The highlight behind the current page's nav item slides to the next one as pages change.
  const navItem = (n) => (
    <button key={n.id} className={`nav-item${active === n.id ? " on" : ""}`} onClick={() => nav.go(n.id)}>
      {active === n.id && <span className="nav-pill" aria-hidden="true"/>}
      <span className="nav-inner" style={{ viewTransitionName: `nav-${n.id}` }}>
        <Icon name={n.icon}/>{n.label}
        {n.id === "today" && plan?.tasks.length > 0 && <span className="nav-count">{plan.tasks.length}</span>}
        {n.id === "notes" && inboxCount > 0 && <span className="nav-count" title="Notes waiting to be processed">{inboxCount}</span>}
        {n.id === "shelf" && recallCount > 0 && <span className="nav-count" title="To recall">{recallCount}</span>}
      </span>
    </button>
  );

  return (
    <NavCtx.Provider value={nav}>
      <div className="window">
        <TitleBar onSearch={() => setPalette(true)}/>
        <div className="app">
          <nav className="sidebar" aria-label="Main">
            {NAV_GROUPS.map((group, gi) => <div key={gi} className="nav-group">{group.map(navItem)}</div>)}
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
            <div className="nav-group">{NAV_BOTTOM.map(navItem)}</div>
          </nav>
          <main className="main">{page}</main>
        </div>
      </div>
      {session && <Session key={session.key} tasks={session.tasks} mode={session.mode} title={session.title} daily={session.daily}/>}
      {palette && <Palette plan={plan} onClose={() => setPalette(false)}/>}
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
