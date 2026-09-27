import { useEffect, useMemo, useState } from "react";
import { StoreProvider, useStore } from "./state/store.jsx";
import { NavCtx } from "./ui/nav.js";
import Icon from "./ui/Icon.jsx";
import { Logo } from "./ui/ui.jsx";
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

const NAV = [
  { id: "today", label: "Today", icon: "today" },
  { id: "courses", label: "Courses", icon: "courses" },
  { id: "map", label: "Knowledge map", icon: "map" },
  { id: "progress", label: "Progress", icon: "progress" },
];

/** Re-render every `ms` so time-based views (due counts, plans) stay current. */
function useNow(ms = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function Shell() {
  const { state } = useStore();
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

  const nav = useMemo(() => ({
    route,
    go: (view, params = {}) => { setRoute({ view, ...params }); document.querySelector(".main")?.scrollTo(0, 0); },
    startSession: (opts) => setSession({ key: Date.now(), ...opts }),
    endSession: () => setSession(null),
    now,
  }), [route, now]);

  if (!state) return <div className="app-loading"/>;

  const active = route.view === "course" || route.view === "import" || route.view === "teach" ? "courses" : route.view;

  let page;
  switch (route.view) {
    case "courses": page = <Courses/>; break;
    case "course": page = <Course courseId={route.courseId} key={route.courseId}/>; break;
    case "import": page = <AddMaterial courseId={route.courseId}/>; break;
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
          <div className="brand"><Logo/>engram</div>
          {NAV.map(n => (
            <button key={n.id} className={`nav-item${active === n.id ? " on" : ""}`} onClick={() => nav.go(n.id)}>
              <Icon name={n.icon}/>{n.label}
              {n.id === "today" && plan?.tasks.length > 0 && <span className="nav-count">{plan.tasks.length}</span>}
            </button>
          ))}
          <div className="nav-spacer"/>
          <button className={`nav-item${active === "settings" ? " on" : ""}`} onClick={() => nav.go("settings")}>
            <Icon name="settings"/>Settings
          </button>
        </nav>
        <main className="main">{page}</main>
      </div>
      {session && <Session key={session.key} {...session}/>}
    </NavCtx.Provider>
  );
}

export default function App() {
  return <StoreProvider><Shell/></StoreProvider>;
}
