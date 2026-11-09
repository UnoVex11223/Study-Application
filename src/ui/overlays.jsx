// Things that open over the page: a drawer at the side, a modal dialog in the
// middle, and a menu under a ⋯ button. Closing one with Escape, the scrim or
// its close button plays a short exit first (closing it from code removes it
// at once).

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { cx } from "./cx.js";
import { useKey, useDismiss } from "./hooks.js";
import { stillMotion } from "./motion.js";

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

/**
 * A panel at the right edge (a concept, a book's notes, questions to fix).
 * `context` is a line above the title (where it lives); `modeless` leaves the page usable behind it.
 */
export function Drawer({ title, context, actions, onClose, modeless = false, enter = true, children }) {
  const [leaving, close] = useExit(onClose, 200);
  useKey((e) => { if (e.key === "Escape") close(); }, [close]);
  return (
    <>
      {!modeless && <div className={cx("scrim", leaving && "leaving")} onClick={close}/>}
      <aside className={cx("drawer", leaving && "leaving", !enter && "no-enter")} role="dialog" aria-label={typeof title === "string" ? title : undefined}>
        <div className="drawer-head">
          <div className="grow">
            {context && <div className="drawer-context">{context}</div>}
            <h2 className="drawer-title">{title}</h2>
          </div>
          {actions}
          <button className="btn btn-quiet btn-icon" onClick={close} aria-label="Close"><Icon name="x"/></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

/** A dialog in the middle of the window. size: "sm" | "md" (default) | "lg". The footer holds its buttons, the main one last. */
export function Modal({ title, footer, size = "md", onClose, children }) {
  const [leaving, close] = useExit(onClose, 130);
  useKey((e) => { if (e.key === "Escape") close(); }, [close]);
  return (
    <>
      <div className={cx("scrim", leaving && "leaving")} onClick={close}/>
      <div className={cx("modal", size !== "md" && size, leaving && "leaving")} role="dialog" aria-label={title}>
        {title && <h2 className="modal-title">{title}</h2>}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </>
  );
}

/** Asks before something that can't be undone: what will happen, then Cancel and the action. */
// Cancel has the focus, so a stray Enter never confirms something you can't undo.
export function ConfirmDialog({ title, action, onConfirm, onClose, children }) {
  return (
    <Modal title={title} size="sm" onClose={onClose} footer={<>
      <button className="btn btn-quiet" onClick={onClose} autoFocus>Cancel</button>
      <button className="btn btn-danger" onClick={() => { onConfirm(); onClose(); }}>{action}</button>
    </>}>
      <p>{children}</p>
    </Modal>
  );
}

/**
 * A ⋯ button that opens a short list of <MenuItem>s. It closes on a choice, a
 * click elsewhere or Escape. `onOpenChange` lets a parent react (lift a card above its neighbours).
 */
export function Menu({ label, onOpenChange, trigger = "btn btn-quiet btn-sm btn-icon", children }) {
  const [open, setOpenState] = useState(false);
  const ref = useRef(null);
  const setOpen = useCallback((v) => { setOpenState(v); onOpenChange?.(v); }, [onOpenChange]);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useDismiss(ref, open, close);
  return (
    <div className={cx("menu", open && "open")} ref={ref}>
      <button type="button" className={trigger} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <Icon name="more"/>
      </button>
      {open && <div className="menu-list" role="menu" onClick={close}>{children}</div>}
    </div>
  );
}

/** One action in a menu. `danger` marks something destructive (shown in red). */
export function MenuItem({ icon, danger = false, children, ...props }) {
  return (
    <button type="button" role="menuitem" className={cx("menu-item", danger && "danger")} {...props}>
      {icon && <Icon name={icon}/>}{children}
    </button>
  );
}

/** A menu that opens where you right-clicked (`at` is { x, y }). */
export function PointerMenu({ at, onClose, children }) {
  const ref = useRef(null);
  useDismiss(ref, true, onClose);
  useEffect(() => { ref.current?.querySelector("button")?.focus(); }, []);
  const left = Math.min(at.x, window.innerWidth - 220), top = Math.min(at.y, window.innerHeight - 140);
  return <div className="menu-list at-pointer" role="menu" ref={ref} style={{ left, top }} onClick={onClose}>{children}</div>;
}
