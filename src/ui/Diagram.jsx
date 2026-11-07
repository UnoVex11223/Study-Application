// A diagram drawn from its spec (lib/diagram.js lays it out; this only turns
// the scene into SVG). Colours come from the theme through styles/diagram.css,
// so a circuit or a pointer diagram looks right in light and dark.

import { useId, useMemo } from "react";
import { drawDiagram, DIAGRAM_KINDS } from "../lib/diagram.js";

export default function Diagram({ spec, className = "" }) {
  const scene = useMemo(() => (spec ? drawDiagram(spec) : null), [spec]);
  const arrow = `dg-ah-${useId().replace(/:/g, "")}`;
  if (!scene) return null;
  return (
    <figure className={`diagram ${className}`}>
      <svg viewBox={`0 0 ${scene.width} ${scene.height}`} width={scene.width} height={scene.height}
        role="img" aria-label={DIAGRAM_KINDS[spec.type] ?? "Diagram"}>
        <defs>
          <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="dg-head"/>
          </marker>
        </defs>
        {scene.shapes.map((s, i) => {
          const cls = s.cls.split(" ").map(c => `dg-${c}`).join(" ");
          if (s.kind === "path") return <path key={i} d={s.d} className={cls} markerEnd={s.marker ? `url(#${arrow})` : undefined}/>;
          if (s.kind === "rect") return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx ?? 3} className={cls}/>;
          if (s.kind === "circle") return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} className={cls}/>;
          return <text key={i} x={s.x} y={s.y} textAnchor={s.anchor || "start"} className={cls}>{s.text}</text>;
        })}
      </svg>
    </figure>
  );
}
