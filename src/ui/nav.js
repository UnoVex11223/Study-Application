// Non-component UI helpers (kept out of .jsx files so fast refresh stays happy).
import { createContext, useContext, useEffect } from "react";
import { ABILITIES } from "../lib/model.js";

/** Navigation + a clock that ticks once a minute ({ route, go, startSession, endSession, now }). */
export const NavCtx = createContext(null);
export const useNav = () => useContext(NavCtx);

export function useKey(handler, deps) {
  useEffect(() => {
    const on = (e) => handler(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export const isTyping = (e) => {
  const t = e.target;
  return Boolean(t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable));
};

export const abilityLabel = (a) => ABILITIES[a]?.label ?? a;
export const pct = (x) => `${Math.round((x || 0) * 100)}%`;
