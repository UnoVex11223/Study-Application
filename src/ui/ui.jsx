import Icon from "./Icon.jsx";
import { useKey } from "./nav.js";
import { IMPORTANCE } from "../lib/model.js";
import { STATUS } from "../lib/mastery.js";

// ── Overlays ────────────────────────────────────────────────────────────────
export function Drawer({ onClose, title, subtitle, actions, children }) {
  useKey((e) => { if (e.key === "Escape") onClose(); }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose}/>
      <aside className="drawer" role="dialog" aria-label={typeof title === "string" ? title : undefined}>
        <div className="drawer-head">
          <div className="grow">
            {subtitle && <div className="muted small" style={{ marginBottom: 4 }}>{subtitle}</div>}
            <h2>{title}</h2>
          </div>
          {actions}
          <button className="btn btn-quiet btn-icon" onClick={onClose} aria-label="Close"><Icon name="x"/></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Modal({ onClose, title, children, footer, width }) {
  useKey((e) => { if (e.key === "Escape") onClose(); }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose}/>
      <div className="modal" role="dialog" aria-label={title} style={width ? { width } : undefined}>
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

export const StatusDot = ({ status }) => <span className={`status-dot ${status}`} title={STATUS[status]?.label}/>;

export function ImportanceTag({ importance }) {
  const meta = IMPORTANCE[importance];
  if (!meta) return null;
  return <span className={`tag${importance === "core" ? " tag-core" : ""}`}>{meta.label}</span>;
}

export function Notice({ tone, icon = "info", children }) {
  return <div className={`notice${tone ? ` notice-${tone}` : ""}`}><Icon name={icon} size={16}/><div>{children}</div></div>;
}

export function Spinner() { return <span className="spinner" aria-hidden="true"/>; }
