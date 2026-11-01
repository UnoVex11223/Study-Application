// Small pieces that show information: progress bars, sparklines, rows of
// figures, status dots, tags, notices, stars, the logo.

import { useState } from "react";
import Icon from "./Icon.jsx";
import { cx } from "./cx.js";
import { sparkPoints } from "../lib/history.js";
import { IMPORTANCE, courseInk } from "../lib/model.js";
import { STATUS } from "../lib/mastery.js";

/** A thin progress bar, 0–1. tone "good" fills it green. */
export function Bar({ value, tone, thin = false }) {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100;
  return <div className={cx("bar", thin && "thin", tone)}><span style={{ width: `${pct}%` }}/></div>;
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

/** A row of key numbers separated by hairlines (four across; `three` for three). */
export function Figures({ three = false, children }) {
  return <div className={cx("figures", three && "three")}>{children}</div>;
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

/** A course's colour as a small dot. */
export const CourseDot = ({ color }) => <span className="dot" style={{ "--c": courseInk(color) }}/>;

/** How well a concept is known, as a dot (see .status-dot). */
export const StatusDot = ({ status }) => <span className={`status-dot ${status}`} title={STATUS[status]?.label}/>;

export function ImportanceTag({ importance }) {
  const meta = IMPORTANCE[importance];
  if (!meta) return null;
  return <span className={cx("tag", importance === "core" && "sky")}>{meta.label}</span>;
}

/** A key point's mark: tone "yes" (✓), "no" (×), "partly" or "none". */
export function CheckMark({ tone }) {
  return <span className={`check-mark ${tone}`}><Icon name={tone === "yes" || tone === "partly" ? "check" : "x"} size={12} stroke={2.6}/></span>;
}

/** A line of information with an icon. tone: none (neutral), "warn", "bad" or "sky" (good news). */
export function Notice({ tone, icon = "info", children }) {
  return <div className={cx("notice", tone)}><Icon name={icon}/><div>{children}</div></div>;
}

export const Spinner = () => <span className="spinner" aria-hidden="true"/>;

/** Five stars; clickable when there's `onChange` (clicking the current rating clears it). */
export function Stars({ value, onChange, size = 15 }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span className={cx("stars", onChange && "editable")} onMouseLeave={() => setHover(0)}
      role={onChange ? "radiogroup" : "img"} aria-label={`${value || 0} of 5 stars`}>
      {[1, 2, 3, 4, 5].map(n => (
        <svg key={n} width={size} height={size} viewBox="0 0 24 24" aria-hidden={!onChange}
          role={onChange ? "radio" : undefined} aria-checked={onChange ? value === n : undefined}
          onMouseEnter={() => onChange && setHover(n)} onClick={() => onChange?.(value === n ? 0 : n)}>
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
            fill={n <= shown ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      ))}
    </span>
  );
}

/** The Tenax mark: a lowercase t whose base is an anchor's arms (tenax: "holding fast"). Colours follow the theme. */
export function Logo({ size = 18 }) {
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
