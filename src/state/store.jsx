import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { loadState, saveState, flush } from "../lib/persist.js";
import { setRolloverHour } from "../lib/time.js";
import { reducer } from "./reducer.js";

const StoreCtx = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null);
  const loaded = useRef(false);

  useEffect(() => {
    loadState().then((s) => dispatch({ type: "load", state: s }));
  }, []);

  useEffect(() => {
    if (!state) return;
    setRolloverHour(state.settings.rolloverHour);
    if (!loaded.current) { loaded.current = true; return; }
    saveState(state);
  }, [state]);

  useEffect(() => () => flush(), []);

  const act = useCallback((type, payload = {}) => dispatch({ type, now: Date.now(), ...payload }), []);
  const value = useMemo(() => ({ state, dispatch, act }), [state, act]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useStore = () => useContext(StoreCtx);
