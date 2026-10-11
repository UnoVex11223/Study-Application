// The knowledge map as a 3D sky (ui/sky3d.js draws it). This page works out
// what's in it (layout from lib/orbits.js, each planet's status and memory
// fog from the store) and adds the controls around it:
//   - pick a planet: it grows into its concept panel and the camera flies to it
//   - Learning path: what that concept builds on, drawn as a constellation
//   - Time-lapse: replay the sky from your first day to today
// Drag to move across the sky, scroll to zoom, right-drag (or Shift-drag) to turn it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store.jsx";
import { useNav } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import ConceptPanel from "./ConceptPanel.jsx";
import { Sky } from "../ui/sky3d.js";
import { transition, stillMotion } from "../ui/motion.js";
import { varyColor } from "../ui/sky.js";
import { index } from "../lib/model.js";
import { conceptMastery } from "../lib/mastery.js";
import { orbitalLayout, seeded, bridgesBetween } from "../lib/orbits.js";
import { prereqPath } from "../lib/graph.js";
import { lapseTimeline, statusOn, lapseDay } from "../lib/timelapse.js";
import { keyToDate } from "../lib/time.js";

const RADIUS = { core: 6.4, supporting: 4.8, detail: 3.7 };
const SLIPPING = "#F2A65A";
const MAX_LABEL = 30;
const LAPSE_SECONDS = 16; // the whole history plays in about this long
const short = (n) => (n.length > MAX_LABEL ? `${n.slice(0, MAX_LABEL - 1)}…` : n);
const panelWidth = () => Math.min(520, window.innerWidth * 0.92) + 20;

function planetKind(status, locked) {
  if (locked) return "dust";
  if (status === "mastered") return "bright";
  if (status === "slipping") return "slipping";
  if (status === "learning" || status === "practiced") return "lit";
  return "dark";
}

/** How far a concept has faded: none at a 92% recall chance, fully hazed by about 37%. */
const fogFor = (m) => (m.started && m.memory != null ? Math.max(0, Math.min(1, (0.92 - m.memory) / 0.55)) : 0);

export default function SkyMap({ scope, focusConceptId, onView }) {
  const { state } = useStore();
  const nav = useNav();
  const ix = index(state);
  const [selected, setSelected] = useState(focusConceptId ?? null);
  const [pathOn, setPathOn] = useState(false);
  const [lapse, setLapse] = useState(null); // null | { t (days from the start), playing }
  const hostRef = useRef(null);
  const skyRef = useRef(null);

  // ── What's in the sky ───────────────────────────────────────────────────
  const concepts = useMemo(() => state.concepts.filter(c => !c.suspended && (scope === "all" || c.courseId === scope)), [state.concepts, scope]);
  // The scene's shape: what's in it and how it's laid out, but not how each planet looks.
  const shapeKey = useMemo(() => [
    scope, concepts.map(c => `${c.id}:${c.sectionId}:${c.importance}:${c.name}`).join("|"),
    state.sections.map(s => `${s.id}:${s.order}:${s.locked ? 1 : 0}`).join("|"),
    state.courses.map(c => `${c.id}:${c.color}:${c.name}`).join("|"),
    state.edges.map(e => `${e.from}>${e.to}:${e.confidence ?? 1}`).join("|"),
  ].join("#"), [scope, concepts, state.sections, state.courses, state.edges]);

  const data = useMemo(() => {
    const ix2 = index(state);
    const orbit = orbitalLayout({ courses: state.courses.filter(c => scope === "all" || c.id === scope), sections: state.sections, concepts });
    const perSystem = new Map();
    for (const c of concepts) perSystem.set(c.courseId, (perSystem.get(c.courseId) || 0) + 1);
    const systems = orbit.systems.map(sys => ({ ...sys, sunR: 15 + Math.min(13, Math.sqrt(perSystem.get(sys.id) || 1) * 1.6) }));
    const planets = concepts.filter(c => orbit.planets[c.id]).map(c => ({
      id: c.id, courseId: c.courseId, name: short(c.name), core: c.importance === "core", r: RADIUS[c.importance] ?? 5,
      orbit: orbit.planets[c.id], color: varyColor(ix2.course[c.courseId]?.color || "#8A93A6", seeded(c.id, 3)), kind: "dark", fog: 0,
    }));
    const inSky = new Set(planets.map(p => p.id));
    const links = state.edges.filter(e => inSky.has(e.from) && inSky.has(e.to)).map(e => ({
      a: e.from, b: e.to, cross: ix2.concept[e.from]?.courseId !== ix2.concept[e.to]?.courseId, provisional: (e.confidence ?? 1) < 0.6,
    }));
    const bridges = scope === "all" ? bridgesBetween(links.filter(l => l.cross).map(l => ({ a: ix2.concept[l.a].courseId, b: ix2.concept[l.b].courseId }))) : [];
    return { systems, planets, links, bridges, oneCourse: scope !== "all", inSky };
  }, [state, scope, concepts]);

  // Each planet's status and fog, now.
  const looks = useMemo(() => {
    const out = {};
    for (const p of data.planets) {
      const m = conceptMastery(state, p.id, nav.now);
      out[p.id] = { kind: planetKind(m.status, ix.lockedConcepts.has(p.id)), fog: fogFor(m) };
    }
    return out;
  }, [data, state, ix, nav.now]);

  // ── The engine ──────────────────────────────────────────────────────────
  const chooseRef = useRef(null);
  useEffect(() => {
    const sky = new Sky(hostRef.current, { onSelect: (id) => chooseRef.current?.(id), still: stillMotion() });
    skyRef.current = sky;
    hostRef.current.sky = sky; // for the interface tests
    return () => { sky.dispose(); skyRef.current = null; };
  }, []);
  // Rebuild the scene only when its shape changes (not on every answer: looks are updated below).
  useEffect(() => {
    const sky = skyRef.current;
    if (sky.shape === shapeKey) return;
    const first = sky.shape == null;
    sky.shape = shapeKey;
    sky.setData(data);
    if (first) sky.fit(0);
  }, [data, shapeKey]);

  // The time-lapse replays history; otherwise the sky is as it is today.
  const lapsing = lapse != null;
  const timeline = useMemo(() => (lapsing ? lapseTimeline(state, nav.now, state.settings.rolloverHour) : null), [lapsing, state, nav.now]);
  const lapseDayKey = timeline ? lapseDay(timeline, lapse.t) : null;
  useEffect(() => {
    const sky = skyRef.current;
    if (!timeline) { sky.setVisible(null); sky.setLooks(looks); return; }
    const shown = [], out = {};
    for (const p of data.planets) {
      if ((timeline.appear[p.id] || timeline.end) > lapseDayKey) continue;
      shown.push(p.id);
      out[p.id] = { kind: planetKind(statusOn(timeline.changes[p.id], lapseDayKey), ix.lockedConcepts.has(p.id)), fog: 0 };
    }
    sky.setVisible(shown);
    sky.setLooks(out);
  }, [timeline, lapseDayKey, looks, data, ix]);
  useEffect(() => {
    if (!lapse?.playing || !timeline) return undefined;
    let raf = 0, last = performance.now();
    const step = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setLapse(l => {
        if (!l?.playing) return l;
        const t = l.t + dt * Math.max(1, timeline.days / LAPSE_SECONDS);
        return t >= timeline.days - 1 ? { t: timeline.days - 1, playing: false } : { ...l, t };
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [lapse?.playing, timeline]);

  // ── Choosing a planet ───────────────────────────────────────────────────
  const selectedRefCurrent = useRef(selected);
  // With no panel open, the planet grows into it (a "sheet" view transition from a disc where it is).
  const choose = useCallback((id) => {
    const sky = skyRef.current;
    if (!id) { setSelected(null); return; }
    const at = sky.project(id), host = hostRef.current?.getBoundingClientRect();
    if (!selectedRefCurrent.current && at && host) {
      const rad = Math.max(8, at.r * 1.6);
      const p = data.planets.find(x => x.id === id);
      const ghost = document.createElement("div");
      ghost.className = "planet-ghost";
      Object.assign(ghost.style, {
        left: `${host.left + at.x - rad}px`, top: `${host.top + at.y - rad}px`, width: `${rad * 2}px`, height: `${rad * 2}px`,
        background: `radial-gradient(circle at 36% 36%, #fff 0, ${p?.color || "#9fb0ff"} 40%, transparent 72%)`, viewTransitionName: "sheet",
      });
      document.body.appendChild(ghost);
      transition(() => { ghost.remove(); setSelected(id); }, "sheet");
    } else setSelected(id);
    sky.flyToPlanet(id, panelWidth());
  }, [data]);
  useEffect(() => { selectedRefCurrent.current = selected; chooseRef.current = choose; }, [selected, choose]);
  useEffect(() => { skyRef.current?.setFocus({ selected }); }, [selected]);
  // Opened at a concept ("Show on map"): fly to it once the sky is there.
  useEffect(() => {
    if (!focusConceptId) return undefined;
    const t = setTimeout(() => skyRef.current?.flyToPlanet(focusConceptId, panelWidth()), 250);
    return () => clearTimeout(t);
  }, [focusConceptId]);

  // ── The learning path ───────────────────────────────────────────────────
  const path = useMemo(() => {
    if (!selected) return null;
    const p = prereqPath(state.edges, selected);
    const nodes = p.nodes.filter(id => data.inSky.has(id));
    return { ...p, nodes, links: p.links.filter(l => data.inSky.has(l.from) && data.inSky.has(l.to)) };
  }, [selected, state.edges, data]);
  const hasPath = Boolean(path && path.nodes.length > 1);
  useEffect(() => {
    const sky = skyRef.current;
    if (pathOn && hasPath) { sky.setPath(path); sky.flyToPlanets(path.nodes, panelWidth()); }
    else sky.setPath(null);
  }, [pathOn, hasPath, path]);

  // Starting a time-lapse shows the whole sky from the beginning.
  const toggleLapse = () => {
    if (lapse) { setLapse(null); return; }
    setSelected(null); setPathOn(false);
    skyRef.current?.fit();
    setLapse({ t: 0, playing: true });
  };

  const coursesWithConcepts = state.courses.filter(c => state.concepts.some(k => k.courseId === c.id && !k.suspended));
  const lapseLabel = lapseDayKey ? keyToDate(lapseDayKey).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "";

  return (
    <div className="page map-page">
      <div className="page-head">
        <div><h1>Knowledge map</h1></div>
        <div className="row">
          <button className={`btn${lapse ? " on" : ""}`} onClick={toggleLapse} aria-pressed={Boolean(lapse)}>
            <Icon name={lapse ? "x" : "play"} size={12}/>Time-lapse
          </button>
          {scope !== "all" && (
            <div className="seg" role="group" aria-label="Map view">
              <button className="on">Orbits</button>
              <button onClick={() => onView({ scope, mode: "prereq" })}>Prerequisites</button>
            </div>
          )}
          <select className="select" style={{ width: 260 }} value={scope} onChange={e => { setSelected(null); setPathOn(false); onView({ scope: e.target.value, mode: "orbits" }); }} aria-label="Map scope">
            <option value="all">All books and courses</option>
            {coursesWithConcepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="map-wrap space sky3d">
        <div className="sky3d-host" ref={hostRef}/>
        <div className="map-zoom">
          <button className="btn btn-icon btn-sm" onClick={() => skyRef.current?.zoom(1.3)} aria-label="Zoom in"><Icon name="zoomIn" size={16}/></button>
          <button className="btn btn-icon btn-sm" onClick={() => skyRef.current?.zoom(0.77)} aria-label="Zoom out"><Icon name="zoomOut" size={16}/></button>
          <button className="btn btn-icon btn-sm" onClick={() => skyRef.current?.fit()} aria-label="Fit to screen"><Icon name="fit" size={16}/></button>
        </div>
        {selected && (
          <div className="map-chips">
            <button className={`map-chip${pathOn && hasPath ? " on" : ""}`} onClick={() => setPathOn(v => !v)} disabled={!hasPath}
              title={hasPath ? "" : "Nothing comes before this concept"}>
              <Icon name="map" size={13}/>{pathOn && hasPath ? `Learning path · ${path.nodes.length} steps` : "Learning path"}
            </button>
          </div>
        )}
        {lapse && timeline && (
          <div className="lapse-bar">
            <button className="btn btn-icon btn-sm" onClick={() => setLapse(l => ({ t: l.t >= timeline.days - 1 ? 0 : l.t, playing: !l.playing }))} aria-label={lapse.playing ? "Pause" : "Play"}>
              <Icon name={lapse.playing ? "pause" : "play"} size={13}/>
            </button>
            <input type="range" min={0} max={Math.max(0, timeline.days - 1)} step={1} value={Math.round(lapse.t)} aria-label="Day"
              onChange={e => setLapse({ t: Number(e.target.value), playing: false })}/>
            <span className="lapse-date">{lapseLabel}</span>
          </div>
        )}
        <div className="map-legend">
          <span><span className="dot planet bright" style={{ "--c": "#9FB0FF" }}/>Mastered</span>
          <span><span className="dot planet" style={{ "--c": "#8F9AD0" }}/>Learning</span>
          <span><span className="dot planet bright" style={{ "--c": SLIPPING }}/>Slipping</span>
          {!lapse && <span><span className="dot planet fading" style={{ "--c": "#8F9AD0" }}/>Fading</span>}
          <span><span className="dot planet dark" style={{ "--c": "#9FB0FF" }}/>Not started</span>
          {ix.lockedConcepts.size > 0 && <span><span className="dot planet dust"/>Unread chapter</span>}
          {data.bridges.length > 0 && <span><span className="legend-stream"/>Links between books</span>}
        </div>
      </div>

      {selected && ix.concept[selected] && (
        <ConceptPanel modeless enter={false} conceptId={selected} onOpen={(id) => (data.inSky.has(id) ? choose(id) : setSelected(id))} onClose={() => { setSelected(null); setPathOn(false); }}/>
      )}
    </div>
  );
}
