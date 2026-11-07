// Short-lived background work that should keep going while you move around
// the app: topping up questions, and rebuilding questions as ladders. (Book
// imports have their own, persistent runner in bookImport.jsx.) Nothing here
// is saved; work interrupted by closing the app can simply be started again:
// a top-up only fills gaps, and a rebuild skips concepts already rebuilt.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store.jsx";
import { api, moreQuestions, rebuildLadders } from "../lib/ai.js";
import { rebuildViaBatch } from "../lib/batchWriter.js";

// Half-price rebuilds wait on a batch for minutes (sometimes up to an hour), so
// the batch is remembered on this computer and picked back up after a restart
// instead of being paid for twice. (Not synced: a batch belongs to the
// computer, and the API key, that started it.)
const PENDING = "tenax.rebuilds";
const readPending = () => { try { return JSON.parse(localStorage.getItem(PENDING) || "[]"); } catch { return []; } };
const writePending = (list) => { try { localStorage.setItem(PENDING, JSON.stringify(list)); } catch { /* best effort */ } };
const savePending = (job) => writePending([...readPending().filter(j => j.id !== job.id), job]);
const dropPending = (id) => writePending(readPending().filter(j => j.id !== id));

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
      onItems: (items, lessons = {}) => {
        if (items.length) act("items/add", { items });
        for (const [conceptId, lesson] of Object.entries(lessons)) act("concept/update", { id: conceptId, patch: { lesson } });
      },
      onProgress: (p) => patch(id, p),
    }).catch(err => ({ ok: false, error: err?.message || "Something went wrong." }));
    patch(id, res.ok
      ? { status: "done", added: res.added, concepts: res.concepts, error: res.partial || "" }
      : { status: "failed", error: res.error });
    return res;
  }, [act]);

  // Questions rebuilt as ladders. Live: a concept at a time as each group
  // finishes. Half price (Settings → Batches): through the Batch API, all at once.
  const runRebuild = useCallback(async (job) => {
    const { id, label, courseId, sectionId, conceptIds } = job;
    const batch = job.batch && Boolean(api()?.batchCreate);
    setTasks(ts => [...ts.filter(t => t.id !== id), { id, kind: "rebuild", label, courseId, sectionId, status: "running", batch, stage: job.saved?.stage ?? "write", done: 0, total: 0, rebuilt: 0, steps: 0 }]);
    const onLadder = (l) => act("concept/ladder", l);
    let res = null;
    if (batch) {
      savePending(job);
      res = await rebuildViaBatch({
        getState: () => stateRef.current, courseId, conceptIds, saved: job.saved ?? null, onLadder,
        onSaved: (saved) => { savePending({ ...job, saved }); patch(id, { stage: saved.stage }); },
      }).catch(err => ({ ok: false, error: err?.message || "Something went wrong." }));
      // A batch that couldn't even start (or was lost) is done live instead.
      if (res.batchUnavailable) res = null;
    }
    if (!res) {
      patch(id, { batch: false });
      res = await rebuildLadders({ state: stateRef.current, conceptIds, onLadder, onProgress: (p) => patch(id, p) })
        .catch(err => ({ ok: false, error: err?.message || "Something went wrong." }));
    }
    dropPending(id);
    patch(id, res.ok
      ? { status: "done", rebuilt: res.rebuilt, steps: res.steps, concepts: res.concepts, error: res.partial || "" }
      : { status: "failed", error: res.error });
    return res;
  }, [act]);

  const rebuild = useCallback(({ label, courseId, sectionId = null, conceptIds }) => runRebuild({
    id: `r${Date.now().toString(36)}`, label, courseId, sectionId, conceptIds,
    batch: stateRef.current?.settings?.batchImports !== false,
  }), [runRebuild]);

  // Rebuilds still waiting on a batch when the app last closed carry on.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !state) return undefined;
    resumed.current = true;
    const pending = readPending();
    // Once, a tick later (not cancelled when the library changes meanwhile, or the jobs would never resume).
    if (pending.length) setTimeout(() => { for (const job of pending) runRebuild(job); }, 0);
    return undefined;
  }, [state, runRebuild]);

  const dismiss = useCallback((id) => setTasks(ts => ts.filter(t => t.id !== id)), []);
  const value = useMemo(() => ({ tasks, topUp, rebuild, dismiss }), [tasks, topUp, rebuild, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useBackground = () => useContext(Ctx);
