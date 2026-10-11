// Motion: one set of curves and timings for the whole app. The CSS side is the
// --ease-* and --dur-* tokens in styles.css; these mirror them for script.
//
// Changing page, opening a session or a concept, and a book flying from the
// shelf into its course run as view transitions: the browser takes a picture
// of the old screen, React renders the new one, and the two are animated
// between (styles.css, "Motion"). Each kind of change has a type, so the CSS
// can animate them differently:
//   page     the page crossfades and the new one rises a little
//   book     a book on the shelf flies into the course page's header
//   sheet    a planet on the map grows into its concept panel
//   session  a study session slides up over everything, and back down
// With reduced motion turned on, changes happen at once.

import { flushSync } from "react-dom";

export const EASE = {
  out: "cubic-bezier(.2, .8, .2, 1)",       // most things: quick start, soft landing
  inOut: "cubic-bezier(.65, 0, .35, 1)",    // things that travel across the screen
  spring: "cubic-bezier(.34, 1.36, .64, 1)", // a small overshoot, for things that pop in
};
export const DUR = { quick: 140, base: 240, slow: 420, travel: 560 };

export const stillMotion = () =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/**
 * Run a state change (React state setters) as a view transition of this type.
 * Returns the transition, or null when it ran straight away.
 */
export function transition(update, type = "page") {
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc?.startViewTransition || stillMotion()) { update(); return null; }
  try {
    return doc.startViewTransition({ update: () => flushSync(update), types: [type] });
  } catch {
    update(); // a browser without view transition types
    return null;
  }
}
