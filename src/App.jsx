// The app: data providers around the shell. The shell holds what's on screen
// (the route, a study session, the palette) and hands navigation to every
// page through NavCtx (ui/nav.js). Pages live in views/, one folder each;
// app/routes.jsx says which one shows for a route.

import { useEffect, useMemo, useState } from "react";
import { StoreProvider, useStore } from "./state/store.jsx";
import { SyncProvider } from "./state/sync.jsx";
import { BookImportProvider } from "./state/bookImport.jsx";
import { BackgroundProvider } from "./state/background.jsx";
import { buildPlan } from "./lib/planner.js";
import { dueForRecall } from "./lib/recall.js";
import { NavCtx } from "./ui/nav.js";
import { useKey, useNow } from "./ui/hooks.js";
import { transition } from "./ui/motion.js";
import { setSounds } from "./ui/sound.js";
import { useTheme } from "./app/theme.js";
import { pageFor, navItemFor } from "./app/routes.jsx";
import TitleBar from "./app/TitleBar.jsx";
import Sidebar from "./app/Sidebar.jsx";
import Palette from "./app/Palette.jsx";
import { StorageNotice, LoadError } from "./app/StorageNotice.jsx";
import Session from "./views/session/Session.jsx";

// Counts page changes, so going to the page you're on starts it afresh (the Shelf's year view closes, say).
let navCount = 0;

function Shell() {
  const { state, storage, retryLoad } = useStore();
  const [route, setRoute] = useState({ view: "today" });
  const [session, setSession] = useState(null);
  const [palette, setPalette] = useState(false);
  const now = useNow();

  useTheme(state?.settings.theme ?? "dark");
  useEffect(() => { setSounds(state?.settings.sounds); }, [state?.settings.sounds]);

  const plan = useMemo(() => (state ? buildPlan(state, { now }) : null), [state, now]);

  // Ctrl+Shift+N: capture a note from anywhere. Ctrl+K: the palette (not during a session).
  useKey((e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && e.shiftKey && key === "n") {
      e.preventDefault();
      transition(() => { setSession(null); setRoute({ view: "notes", capture: Date.now() }); });
    } else if (mod && !e.shiftKey && key === "k" && !session) {
      e.preventDefault();
      setPalette(p => !p);
    }
  }, [session]);

  const nav = useMemo(() => ({
    route,
    now,
    // Every page change is a view transition (ui/motion.js); `type` picks how it moves.
    go: (view, params = {}, { type = "page" } = {}) => transition(() => {
      setRoute({ view, ...params, n: (navCount += 1) });
      document.querySelector(".main")?.scrollTo(0, 0);
    }, type),
    startSession: (opts) => transition(() => setSession({ key: Date.now(), ...opts }), "session"),
    endSession: () => transition(() => setSession(null), "session"),
  }), [route, now]);

  if (!state) {
    if (!storage.loadError) return <div className="app-loading"/>;
    return <div className="window"><TitleBar/><LoadError message={storage.loadError} onRetry={retryLoad}/></div>;
  }

  const counts = {
    today: plan?.tasks.length ?? 0,
    notes: state.notes.filter(n => n.status === "inbox").length,
    shelf: dueForRecall(state.shelf, now).length,
  };

  return (
    <NavCtx.Provider value={nav}>
      <div className="window">
        <TitleBar onSettings={() => nav.go("settings")} settingsOn={route.view === "settings"}/>
        <div className="app">
          <Sidebar active={navItemFor(route)} counts={counts}/>
          <main className="main">{pageFor(route, { plan })}</main>
        </div>
      </div>
      {session && <Session key={session.key} tasks={session.tasks} mode={session.mode} title={session.title} daily={session.daily}/>}
      {palette && <Palette plan={plan} onClose={() => setPalette(false)}/>}
      <StorageNotice/>
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
