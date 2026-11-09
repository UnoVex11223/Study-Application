// The knowledge map as a 3D sky (ui/sky3d.js draws it). This page works out
// what's in it (layout from lib/orbits.js, each planet's status and memory
// fog from the store). Point at a planet and it and its connections light
// up (planets aren't clickable: the map is for seeing how things connect;
// "Show on map" lights one up and flies to it). Drag to move across the sky,
// scroll to zoom, right-drag (or Shift-drag) to turn it.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store.jsx";
import { useNav } from "../../ui/nav.js";
import { Page } from "../../ui/layout.jsx";
import { stillMotion } from "../../ui/motion.js";
import { index } from "../../lib/model.js";
import { conceptMastery } from "../../lib/mastery.js";
import { orbitalLayout, seeded, bridgesBetween } from "../../lib/orbits.js";
import { MapHeader, MapLegend } from "./MapChrome.jsx";
import { Sky } from "./sky3d.js";
import { varyColor } from "./sky.js";

const RADIUS = { core: 6.4, supporting: 4.8, detail: 3.7 };
const MAX_LABEL = 30;
const short = (n) => (n.length > MAX_LABEL ? `${n.slice(0, MAX_LABEL - 1)}…` : n);

function planetKind(status, locked) {
  if (locked) return "dust";
  if (status === "mastered") return "bright";
  if (status === "slipping") return "slipping";
  if (status === "learning" || status === "practiced") return "lit";
  return "dark";
}

/** How far a concept has faded: none at a 92% recall chance, fully hazed by about 37%. */
const fogFor = (m) => (m.started && m.memory != null ? Math.max(0, Math.min(1, (0.92 - m.memory) / 0.55)) : 0);

export default function SkyMap({ scope, focusConceptId }) {
  const { state } = useStore();
  const nav = useNav();
  const ix = index(state);
  const [selected, setSelected] = useState(focusConceptId ?? null);
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
      id: c.id, courseId: c.courseId, name: short(c.name), fullName: c.name, core: c.importance === "core", r: RADIUS[c.importance] ?? 5,
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
  useEffect(() => {
    // Clicking empty sky clears a highlighted planet; planets themselves can't be picked.
    const sky = new Sky(hostRef.current, { onSelect: (id) => { if (!id) setSelected(null); }, still: stillMotion(), selectable: false });
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

  // The sky as it is today.
  useEffect(() => { skyRef.current?.setLooks(looks); }, [looks]);

  // ── A highlighted planet ("Show on map") ────────────────────────────────
  useEffect(() => { skyRef.current?.setFocus({ selected }); }, [selected]);
  useEffect(() => {
    if (!focusConceptId) return undefined;
    const t = setTimeout(() => skyRef.current?.flyToPlanet(focusConceptId), 250);
    return () => clearTimeout(t);
  }, [focusConceptId]);

  return (
    <Page width="full" className="map-page">
      <MapHeader/>

      <div className="map-wrap space sky3d">
        <div className="sky3d-host" ref={hostRef}/>
        <MapLegend/>
      </div>

    </Page>
  );
}
