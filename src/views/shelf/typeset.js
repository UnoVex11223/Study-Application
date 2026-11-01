// Setting titles on spines (the spine view and the year's pile): measuring text
// in the fonts it's drawn in, and a spine's colours. Shared by SpineShelf and YearView.

import { useSyncExternalStore } from "react";
import { useCoverInfo } from "../../ui/Cover.jsx";
import { clothFor, inkFor } from "../../lib/cover.js";

/** The last name of the first author: "David Thomas and Andrew Hunt" → "Thomas". */
export const lastName = (author) => String(author || "").split(/,|&| and /)[0].trim().split(/\s+/).pop() || "";

// Titles are measured in the fonts they're set in, so layouts are redone once the fonts have loaded.
let fontsLoaded = 0;
const fontListeners = new Set();
if (typeof document !== "undefined" && document.fonts) {
  const bump = () => { fontsLoaded += 1; for (const fn of fontListeners) fn(); };
  document.fonts.ready.then(bump);
  document.fonts.addEventListener?.("loadingdone", bump);
}
/** Changes when web fonts finish loading (use it as a dependency of anything that measures text). */
export const useFonts = () => useSyncExternalStore((fn) => { fontListeners.add(fn); return () => fontListeners.delete(fn); }, () => fontsLoaded);

let ctx = null;
const cssVar = (name, fallback) => (typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

/**
 * A function measuring text set in one of the app's fonts: measure(text, size) → width in px.
 * family: "serif" | "sans"; weight like 500; spacing is letter-spacing in em.
 */
export function measureWith(family, weight, spacing = 0) {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  const font = `${weight} {size} ${cssVar(`--${family}`, family === "serif" ? "serif" : "sans-serif")}`;
  return (text, size) => {
    ctx.font = font.replace("{size}", `${size}px`);
    return ctx.measureText(text).width + spacing * size * text.length;
  };
}

/** A spine's colours: from the cover's left edge, or the cloth for a book without a picture. */
export function useSpineColors(e) {
  const info = useCoverInfo(e.cover);
  const cloth = e.cover ? null : clothFor(e.title);
  const bg = cloth ? cloth.bg : info?.spine || "#2A2C31";
  return { bg, ink: cloth ? cloth.ink : inkFor(bg) };
}
