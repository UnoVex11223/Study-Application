// Keeps this computer in step with your others through the sync folder:
// pulls their copies when the app starts, every few minutes and whenever the
// window regains focus, and merges them in (lib/sync.js). This computer's own
// copy is written by the main process after each change.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useStore } from "./store.jsx";
import { SCHEMA_VERSION } from "../lib/model.js";

const Ctx = createContext(null);
const PULL_EVERY = 3 * 60 * 1000;
const bridge = () => (typeof window !== "undefined" && window.tenax?.sync) || null;

export function SyncProvider({ children }) {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState(null); // from the main process: { enabled, dir, device, others, suggested }
  const [info, setInfo] = useState({ lastSync: null, error: "", skipped: [], busy: false });
  const ready = Boolean(state);

  const refresh = useCallback(async () => {
    const b = bridge();
    if (!b) return null;
    const st = await b.status().catch(() => null);
    setStatus(st);
    return st;
  }, []);

  const pull = useCallback(async ({ all = false } = {}) => {
    const b = bridge();
    const st = await refresh();
    if (!b || !st?.enabled) return;
    setInfo(i => ({ ...i, busy: true }));
    const res = await b.pull({ all }).catch(err => ({ ok: false, error: err?.message }));
    if (!res?.ok) { setInfo(i => ({ ...i, busy: false, error: res?.error || "Couldn't read the sync folder." })); return; }
    const skipped = res.copies.filter(c => (c.state?.version ?? 0) > SCHEMA_VERSION).map(c => c.deviceName);
    if (res.copies.length) dispatch({ type: "sync/merge", copies: res.copies });
    setInfo({ lastSync: Date.now(), error: "", skipped, busy: false });
  }, [dispatch, refresh]);

  useEffect(() => {
    if (!ready) return undefined;
    const first = setTimeout(() => pull({ all: true }), 0);
    const timer = setInterval(() => pull(), PULL_EVERY);
    const onFocus = () => pull();
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [ready, pull]);

  const value = useMemo(() => ({
    status, info,
    device: status?.device ?? null,
    syncNow: () => pull({ all: true }),
    choose: async () => { const b = bridge(); if (!b) return; setStatus(await b.choose()); await pull({ all: true }); },
    useSuggested: async () => { const b = bridge(); if (!b) return; setStatus(await b.useSuggested()); await pull({ all: true }); },
    stop: async () => { const b = bridge(); if (!b) return; setStatus(await b.stop()); setInfo({ lastSync: null, error: "", skipped: [], busy: false }); },
  }), [status, info, pull]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSync = () => useContext(Ctx);
