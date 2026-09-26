import { useEffect, useMemo, useRef, useState } from "react";
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from "d3-force";
import { useStore } from "../state/store.jsx";
import { useNav } from "../ui/nav.js";
import Icon from "../ui/Icon.jsx";
import ConceptPanel from "./ConceptPanel.jsx";
import { index } from "../lib/model.js";
import { conceptMastery } from "../lib/mastery.js";
import { layeredLayout } from "../lib/graph.js";

const STATUS_FILL = {
  mastered: "var(--good)", practiced: "var(--accent)", learning: "var(--accent)", slipping: "var(--warn)", new: "var(--surface)",
};
const RADIUS = { core: 7, supporting: 5.5, detail: 4.5 };
const MAX_LABEL = 30;

/** Deterministic pseudo-random in [0, 1) from a string, so layouts don't jump between renders. */
function seeded(id, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

/** Force layout across every course: clusters by course, cross-course links pull related ideas together. */
function globalLayout(allCourses, allEdges, concepts) {
  const courseOf = Object.fromEntries(concepts.map(c => [c.id, c.courseId]));
  const courses = allCourses.filter(c => concepts.some(k => k.courseId === c.id));
  const R = courses.length <= 1 ? 0 : 140 + courses.length * 40;
  const anchor = {};
  courses.forEach((c, i) => {
    const a = (i / Math.max(1, courses.length)) * Math.PI * 2 - Math.PI / 2;
    anchor[c.id] = courses.length === 1 ? { x: 0, y: 0 } : { x: Math.cos(a) * R, y: Math.sin(a) * R };
  });
  const ids = new Set(concepts.map(c => c.id));
  const nodes = concepts.map(c => ({ id: c.id, courseId: c.courseId, half: Math.min(60, 8 + Math.min(c.name.length, MAX_LABEL) * 2.6), x: anchor[c.courseId].x + (seeded(c.id) - 0.5) * 60, y: anchor[c.courseId].y + (seeded(c.id, 7) - 0.5) * 60 }));
  const links = allEdges.filter(e => ids.has(e.from) && ids.has(e.to)).map(e => ({ source: e.from, target: e.to, cross: courseOf[e.from] !== courseOf[e.to] }));
  const sim = forceSimulation(nodes)
    .force("charge", forceManyBody().strength(-45).distanceMax(220))
    .force("link", forceLink(links).id(d => d.id).distance(l => (l.cross ? 160 : 55)).strength(l => (l.cross ? 0.08 : 0.5)))
    .force("x", forceX(d => anchor[d.courseId].x).strength(0.12))
    .force("y", forceY(d => anchor[d.courseId].y).strength(0.12))
    .force("collide", forceCollide(d => d.half).strength(0.9))
    .stop();
  for (let i = 0; i < 320; i++) sim.tick();
  const pos = Object.fromEntries(nodes.map(n => [n.id, { x: n.x, y: n.y }]));
  const labels = courses.map(c => {
    const pts = nodes.filter(n => n.courseId === c.id);
    const minY = Math.min(...pts.map(p => p.y));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    return { id: c.id, name: c.name, color: c.color, x: cx, y: minY - 26 };
  });
  return { pos, labels };
}

function bounds(pos) {
  const xs = Object.values(pos).map(p => p.x), ys = Object.values(pos).map(p => p.y);
  if (!xs.length) return { x0: -100, y0: -100, x1: 100, y1: 100 };
  return { x0: Math.min(...xs) - 100, y0: Math.min(...ys) - 70, x1: Math.max(...xs) + 160, y1: Math.max(...ys) + 90 };
}

export default function KnowledgeMap({ focusCourseId, focusConceptId }) {
  const { state } = useStore();
  const nav = useNav();
  const ix = index(state);
  const [scope, setScope] = useState(focusCourseId ?? "all");
  const [selected, setSelected] = useState(focusConceptId ?? null);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const svgRef = useRef(null);
  const drag = useRef(null);

  const layout = useMemo(() => {
    const concepts = state.concepts.filter(c => !c.suspended && (scope === "all" || c.courseId === scope));
    if (!concepts.length) return { concepts, pos: {}, labels: [] };
    if (scope === "all") return { concepts, ...globalLayout(state.courses, state.edges, concepts) };
    const prereqs = state.edges.filter(e => e.type === "prereq").map(e => ({ from: e.from, to: e.to }));
    const { pos } = layeredLayout(concepts.map(c => ({ id: c.id })), prereqs);
    return { concepts, pos, labels: [] };
  }, [state.concepts, state.edges, state.courses, scope]);
  const concepts = layout.concepts;
  const status = useMemo(() => {
    const out = {};
    for (const c of layout.concepts) out[c.id] = conceptMastery(state, c.id).status;
    return out;
  }, [state, layout]);

  const edges = useMemo(() => state.edges.filter(e => layout.pos[e.from] && layout.pos[e.to]), [state.edges, layout]);

  const fit = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    const b = bounds(layout.pos);
    const k = Math.min(1.4, Math.max(0.2, Math.min(width / (b.x1 - b.x0), height / (b.y1 - b.y0))));
    setView({ k, x: width / 2 - ((b.x0 + b.x1) / 2) * k, y: height / 2 - ((b.y0 + b.y1) / 2) * k });
  };
  useEffect(fit, [layout]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView(v => {
        const k = Math.min(3, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const zoom = (f) => {
    const r = svgRef.current.getBoundingClientRect();
    setView(v => {
      const k = Math.min(3, Math.max(0.15, v.k * f));
      return { k, x: r.width / 2 - ((r.width / 2 - v.x) / v.k) * k, y: r.height / 2 - ((r.height / 2 - v.y) / v.k) * k };
    });
  };

  const focus = hover ?? selected;
  const neighbors = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    for (const e of edges) { if (e.from === focus) s.add(e.to); if (e.to === focus) s.add(e.from); }
    return s;
  }, [focus, edges]);

  const coursesWithConcepts = state.courses.filter(c => state.concepts.some(k => k.courseId === c.id));
  const showAllLabels = scope !== "all" || concepts.length <= 80 || view.k > 1.1;

  return (
    <div className="page" style={{ maxWidth: "none" }}>
      <div className="page-head">
        <div>
          <h1>Knowledge map</h1>
          <div className="page-sub">
            {scope === "all"
              ? "Everything you're learning, clustered by course. Blue lines connect ideas across courses."
              : "Prerequisites flow left to right: each concept builds on the ones to its left."}
          </div>
        </div>
        <select className="select" style={{ width: 260 }} value={scope} onChange={e => { setScope(e.target.value); setSelected(null); }} aria-label="Map scope">
          <option value="all">All courses</option>
          {coursesWithConcepts.map(c => <option key={c.id} value={c.id}>{c.name}: prerequisites</option>)}
        </select>
      </div>

      {!concepts.length ? (
        <div className="panel empty">
          <h3>Nothing to map yet</h3>
          <p>Concepts appear here as you add material to your courses, connected by what they build on.</p>
          <button className="btn btn-primary" onClick={() => nav.go("courses")}>Go to courses</button>
        </div>
      ) : (
        <div className="map-wrap">
          <svg ref={svgRef}
            onPointerDown={e => { if (e.target.closest(".map-node")) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerMove={e => { const d = drag.current; if (!d) return; d.moved = true; setView(v => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })); }}
            onPointerUp={() => { const moved = drag.current?.moved; drag.current = null; if (!moved) setSelected(null); }}>
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-3)"/>
              </marker>
            </defs>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {edges.map(e => {
                const a = layout.pos[e.from], b = layout.pos[e.to];
                const cross = ix.concept[e.from]?.courseId !== ix.concept[e.to]?.courseId;
                const provisional = (e.confidence ?? 1) < 0.6;
                const on = focus && (e.from === focus || e.to === focus);
                const cls = `map-edge${e.type === "prereq" ? " prereq" : ""}${cross ? " cross" : ""}${provisional ? " provisional" : ""}${focus ? (on ? " hl" : " dim") : ""}`;
                const ra = RADIUS[ix.concept[e.from]?.importance] ?? 5, rb = RADIUS[ix.concept[e.to]?.importance] ?? 5;
                const d = scope === "all"
                  ? `M${a.x},${a.y} L${b.x},${b.y}`
                  : `M${a.x + ra + 2},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x - rb - 3},${b.y}`;
                return <path key={e.id} d={d} className={cls} markerEnd={e.type === "prereq" && scope !== "all" ? "url(#arrow)" : undefined}><title>{e.why}</title></path>;
              })}
              {layout.labels.map(l => (
                <text key={l.id} x={l.x} y={l.y} textAnchor="middle" className="map-course-label" style={{ fill: l.color }}>{l.name}</text>
              ))}
              {concepts.map(c => {
                const p = layout.pos[c.id];
                if (!p) return null;
                const st = status[c.id];
                const r = RADIUS[c.importance] ?? 5;
                const course = ix.course[c.courseId];
                const dim = neighbors && !neighbors.has(c.id);
                const label = showAllLabels || c.id === focus || (neighbors?.has(c.id)) || (c.importance === "core" && view.k > 0.7);
                return (
                  <g key={c.id} className={`map-node${dim ? " dim" : ""}`} transform={`translate(${p.x},${p.y})`}
                    onPointerEnter={() => setHover(c.id)} onPointerLeave={() => setHover(null)}
                    onClick={() => setSelected(c.id)}>
                    <circle r={r + 5} fill="transparent"/>
                    <circle r={r} fill={STATUS_FILL[st]} stroke={st === "new" ? course?.color : "var(--surface)"} strokeWidth={st === "new" ? 1.8 : 1.5}/>
                    {c.id === selected && <circle r={r + 4} fill="none" stroke="var(--ink)" strokeWidth={1.4}/>}
                    {label && (scope === "all"
                      ? <text x={0} y={r + 14} textAnchor="middle">{c.name.length > 30 ? `${c.name.slice(0, 29)}…` : c.name}</text>
                      : <text x={0} y={-r - 7} textAnchor="middle">{c.name.length > 30 ? `${c.name.slice(0, 29)}…` : c.name}</text>)}
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="map-zoom">
            <button className="btn btn-icon btn-sm" onClick={() => zoom(1.25)} aria-label="Zoom in"><Icon name="zoomIn" size={16}/></button>
            <button className="btn btn-icon btn-sm" onClick={() => zoom(0.8)} aria-label="Zoom out"><Icon name="zoomOut" size={16}/></button>
            <button className="btn btn-icon btn-sm" onClick={fit} aria-label="Fit to screen"><Icon name="fit" size={16}/></button>
          </div>
          <div className="map-legend">
            <span><span className="dot" style={{ background: "var(--good)" }}/>Mastered</span>
            <span><span className="dot" style={{ background: "var(--accent)" }}/>Learning</span>
            <span><span className="dot" style={{ background: "var(--warn)" }}/>Slipping</span>
            <span><span className="dot" style={{ border: "1.5px solid var(--ink-3)" }}/>Not started</span>
            <span><svg width="22" height="6"><path d="M0 3h22" stroke="var(--ink-3)" strokeDasharray="4 4"/></svg>Unconfirmed link</span>
          </div>
        </div>
      )}

      {selected && <ConceptPanel conceptId={selected} onOpen={setSelected} onClose={() => setSelected(null)}/>}
    </div>
  );
}
