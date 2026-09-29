// Short-lived background work that should keep going while you move around
// the app: topping up questions. (Book imports have their own, persistent
// runner in bookImport.jsx.) Nothing here is saved; a top-up interrupted by
// closing the app can simply be started again, since it only fills gaps.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store.jsx";
import { moreQuestions } from "../lib/ai.js";

const Ctx = createContext(null);

export function BackgroundProvider({ children }) {
  const { state, act } = useStore();
  const [tasks, setTasks] = useState([]);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const patch = (id, p) => setTasks(ts => ts.map(t => (t.id === id ? { ...t, ...p } : t)));

  const topUp = useCallback(async ({ label, courseId, sectionId = null, conceptIds, extraSource }) => {
    const id = `t${Date.now().toString(36)}`;
    setTasks(ts => [...ts, { id, kind: "topUp", label, courseId, sectionId, status: "running", done: 0, total: 0, added: 0 }]);
    const res = await moreQuestions({
      state: stateRef.current, conceptIds, extraSource,
      onItems: (items) => act("items/add", { items }),
      onProgress: (p) => patch(id, p),
    }).catch(err => ({ ok: false, error: err?.message || "Something went wrong." }));
    patch(id, res.ok
      ? { status: "done", added: res.added, concepts: res.concepts, error: res.partial || "" }
      : { status: "failed", error: res.error });
    return res;
  }, [act]);

  const dismiss = useCallback((id) => setTasks(ts => ts.filter(t => t.id !== id)), []);
  const value = useMemo(() => ({ tasks, topUp, dismiss }), [tasks, topUp, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useBackground = () => useContext(Ctx);
