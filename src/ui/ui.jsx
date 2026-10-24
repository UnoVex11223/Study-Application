import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { useKey } from "./nav.js";
import { stillMotion } from "./motion.js";
import { sparkPoints } from "../lib/history.js";
import { IMPORTANCE } from "../lib/model.js";
import { STATUS } from "../lib/mastery.js";

// ── Overlays ────────────────────────────────────────────────────────────────
// Closing with Escape, the scrim or the close button plays a short exit
// before the overlay goes (closing it from code removes it at once).
function useExit(onClose, ms) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = useCallback(() => {
    if (leaving) return;
    if (stillMotion()) { onClose(); return; }
    setLeaving(true);
    timer.current = setTimeout(onClose, ms);
  }, [leaving, onClose, ms]);
  return [leaving, close];
}

export function Drawer({ onClose, title, subtitle, actions, children, modeless = false, enter = true }) {
  const [leaving, close] = useExit(onClose, 200);
  useKey((e) => { if (e.key === "Escape") close(); }, [close]);
  return (
    <>
      {!modeless && <div className={`scrim${leaving ? " leaving" : ""}`} onClick={close}/>}
      <aside className={`drawer${leaving ? " leaving" : ""}${enter ? "" : " no-enter"}`} role="dialog" aria-label={typeof title === "string" ? title : undefined}>
        <div className="drawer-head">
          <div className="grow">
            {subtitle && <div className="muted small" style={{ marginBottom: 4 }}>{subtitle}</div>}
            <h2>{title}</h2>
          </div>
          {actions}
          <button className="btn btn-quiet btn-icon" onClick={close} aria-label="Close"><Icon name="x"/></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Modal({ onClose, title, children, footer, width }) {
  const [leaving, close] = useExit(onClose, 130);
  useKey((e) => { if (e.key === "Escape") close(); }, [close]);
  return (
    <>
      <div className={`scrim${leaving ? " leaving" : ""}`} onClick={close}/>
      <div className={`modal${leaving ? " leaving" : ""}`} role="dialog" aria-label={title} style={width ? { width } : undefined}>
        {title && <h2>{title}</h2>}
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </>
  );
}

// ── Small displays ──────────────────────────────────────────────────────────
export function Bar({ value, tone, thin, color }) {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100;
  return (
    <div className={`bar${thin ? " thin" : ""}${tone === "good" ? " bar-good" : ""}`}>
      <span style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }}/>
    </div>
  );
}

/** A tiny chart beside a number: a line (with a dot on the latest value), bars, or dots for days. */
export function Spark({ values, kind = "line", width = 72, height = 22, label }) {
  if (!values?.length || (kind !== "dots" && !values.some(v => v > 0))) return null; // nothing has happened yet
  const aria = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  if (kind === "bars" || kind === "dots") {
    const n = values.length, gap = kind === "dots" ? 3 : 2;
    const w = (width - gap * (n - 1)) / n, max = Math.max(...values, 1);
    return (
      <svg className={`spark ${kind}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} {...aria}>
        {values.map((v, i) => kind === "dots"
          ? <circle key={i} cx={i * (w + gap) + w / 2} cy={height / 2} r={Math.min(w, height) / 2.1} className={v > 0 ? "on" : "off"}/>
          : <rect key={i} x={i * (w + gap)} y={height - Math.max(1.5, (v / max) * height)} width={w} height={Math.max(1.5, (v / max) * height)} rx={1} className={v > 0 ? "on" : "off"}/>)}
      </svg>
    );
  }
  const pts = sparkPoints(values, width, height, 3);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="spark line" width={width} height={height} viewBox={`0 0 ${width} ${height}`} {...aria}>
      <path d={`${d} L${lx.toFixed(1)} ${height} L${pts[0][0].toFixed(1)} ${height} Z`} className="spark-fill"/>
      <path d={d} className="spark-line" pathLength={1}/>
      <circle cx={lx} cy={ly} r={2.2} className="spark-dot"/>
    </svg>
  );
}

/** A row of numbers with labels (and sparklines), separated by hairlines instead of boxes. */
export function Figures({ children }) {
  return <div className="figures">{children}</div>;
}

export function Figure({ value, of, label, spark }) {
  return (
    <div className="figure">
      <div className="figure-top">
        <span className="figure-value">{value}{of != null && <span className="figure-of"> / {of}</span>}</span>
        {spark}
      </div>
      <div className="figure-label">{label}</div>
    </div>
  );
}

export const StatusDot = ({ status }) => <span className={`status-dot ${status}`} title={STATUS[status]?.label}/>;

export function ImportanceTag({ importance }) {
  const meta = IMPORTANCE[importance];
  if (!meta) return null;
  return <span className={`tag${importance === "core" ? " tag-core" : ""}`}>{meta.label}</span>;
}

export function Notice({ tone, icon = "info", children }) {
  return <div className={`notice${tone ? ` notice-${tone}` : ""}`}><Icon name={icon} size={16}/><div>{children}</div></div>;
}

/** The Tenax mark: a lowercase t whose base is an anchor's arms (tenax: "holding fast"). Colors follow the theme. */
export function Logo({ size = 22 }) {
  const stroke = { fill: "none", stroke: "var(--chrome)", strokeWidth: 112, strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true">
      <rect width="1024" height="1024" rx="236" fill="var(--ink)"/>
      <path d="M512 236V768" {...stroke}/>
      <path d="M384 404H640" {...stroke}/>
      <path d="M312 612C336 724 422 768 512 768C602 768 688 724 712 612" {...stroke}/>
    </svg>
  );
}

export function Spinner() { return <span className="spinner" aria-hidden="true"/>; }
