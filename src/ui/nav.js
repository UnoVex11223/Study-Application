// Navigation: which page is showing, and how to change it. App.jsx provides
// the value; any component reads it with useNav():
//   route         { view, ...params } for the current page
//   go(view, params, { type })  open a page ("courses", "course" + { courseId }, …)
//   startSession({ tasks, mode, title, daily }) / endSession()
//   now           a clock that ticks once a minute
import { createContext, useContext } from "react";

export const NavCtx = createContext(null);
export const useNav = () => useContext(NavCtx);
