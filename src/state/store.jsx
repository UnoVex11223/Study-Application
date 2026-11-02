// The library in memory, and how components read and change it:
//   const { state, act } = useStore();   act("course/update", { id, patch })
// Every change goes through the reducer (reducer.js) and is then saved by
// lib/persist.js, which sends only what changed to the database.
// `storage` says how saving is going: { loadError, saveError, recovered }.

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { loadState, saveState, flush, onSaveStatus } from "../lib/persist.js";
import { setRolloverHour } from "../lib/time.js";
import { hasNotesSpace } from "../lib/notes.js";
import { reducer } from "./reducer.js";

const StoreCtx = createContext(null);
// Actions that swap the whole library: saved by replacing it rather than by what changed.
const REPLACES = new Set(["replace", "reset"]);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null);
  const [storage, setStorage] = useState({ loadError: "", saveError: "", recovered: null });
  const replaceNext = useRef(false);

  const load = useCallback(() => {
    loadState()
      .then(({ state: loaded, recovered }) => {
        dispatch({ type: "load", state: loaded });
        // A library from before notes had areas: as an edit, so it carries over to your other computers.
        if (hasNotesSpace(loaded)) dispatch({ type: "notes/areas", now: Date.now() });
        setStorage(s => ({ ...s, loadError: "", recovered: recovered ?? s.recovered }));
      })
      .catch(err => setStorage(s => ({ ...s, loadError: err?.message || "Tenax couldn't open its library." })));
  }, []);
  useEffect(load, [load]);
  const retryLoad = useCallback(() => { setStorage(s => ({ ...s, loadError: "" })); load(); }, [load]);
  useEffect(() => onSaveStatus(({ error }) => setStorage(s => (s.saveError === error ? s : { ...s, saveError: error }))), []);

  useEffect(() => {
    if (!state) return;
    setRolloverHour(state.settings.rolloverHour);
    saveState(state, { full: replaceNext.current });
    replaceNext.current = false;
  }, [state]);

  useEffect(() => () => { flush(); }, []);

  const act = useCallback((type, payload = {}) => {
    if (REPLACES.has(type)) replaceNext.current = true;
    dispatch({ type, now: Date.now(), ...payload });
  }, []);
  const dismissRecovered = useCallback(() => setStorage(s => ({ ...s, recovered: null })), []);
  const value = useMemo(() => ({ state, dispatch, act, storage, retryLoad, dismissRecovered }), [state, act, storage, retryLoad, dismissRecovered]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useStore = () => useContext(StoreCtx);
