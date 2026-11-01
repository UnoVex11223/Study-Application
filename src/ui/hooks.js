// Small React hooks shared by components (kept out of .jsx files so fast refresh stays happy).
import { useEffect, useState } from "react";

/** Calls `handler` for every key pressed anywhere in the window. */
export function useKey(handler, deps) {
  useEffect(() => {
    const on = (e) => handler(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Is this key press going into a text field (so shortcuts should leave it alone)? */
export const isTyping = (e) => {
  const t = e.target;
  return Boolean(t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable));
};

/** While `open`, a click outside `ref`'s element or Escape calls `onClose` (menus and popovers). */
export function useDismiss(ref, open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [ref, open, onClose]);
}

/** The current time, updated every `ms`, so views that depend on it (what's due) stay current. */
export function useNow(ms = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
