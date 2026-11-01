// The theme (Settings → Theme) on the page, and the same colours on the
// window's own minimise/maximise/close buttons, which the main process draws.
import { useEffect } from "react";

/** A colour token as it shows right now, as #rrggbb (the main process only accepts plain hex). */
function tokenHex(name) {
  const probe = document.createElement("span");
  probe.style.cssText = `display: none; color: var(${name})`;
  document.body.append(probe);
  const [r = 0, g = 0, b = 0] = (getComputedStyle(probe).color.match(/[\d.]+/g) || []).map(Number);
  probe.remove();
  return `#${[r, g, b].map(n => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
}

/** theme: "dark" | "light" | "system" (follows the computer, see styles/tokens.css). */
export function useTheme(theme) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    const paint = () => window.tenax?.window?.chrome?.({ color: tokenHex("--chrome"), symbolColor: tokenHex("--ink-2") });
    paint();
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    media?.addEventListener?.("change", paint);
    return () => media?.removeEventListener?.("change", paint);
  }, [theme]);
}
