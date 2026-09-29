// Keeps whole-book imports running in the background, whichever page you're
// on. A job marked "running" gets a runner, including jobs left running when
// the app was last closed; see lib/bookRunner.js for what a runner does.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useStore } from "./store.jsx";
import { useSync } from "./sync.jsx";
import { runBookJob } from "../lib/bookRunner.js";

const Ctx = createContext(null);
// eslint-disable-next-line react-refresh/only-export-components
export const bookBridge = () => (typeof window !== "undefined" && window.tenax?.book) || null;

export function BookImportProvider({ children }) {
  const { state, act } = useStore();
  const stateRef = useRef(state);
  const running = useRef(new Set());
  const runRef = useRef(null);
  const checked = useRef(new Set());
  const device = useSync()?.device ?? null;

  const run = useCallback((jobId) => {
    const book = bookBridge();
    if (!book || running.current.has(jobId)) return;
    running.current.add(jobId);
    runBookJob({ jobId, getState: () => stateRef.current, act, book })
      .catch(err => act("book/patch", { id: jobId, patch: { status: "paused", error: err?.message || "The import stopped." } }))
      .finally(() => {
        running.current.delete(jobId);
        // Resumed while this runner was finishing its last chapters? Start again.
        setTimeout(() => {
          const j = stateRef.current?.bookJobs.find(x => x.id === jobId);
          if (j?.status === "running" && j.chapters.some(c => c.include && c.status === "pending")) runRef.current?.(jobId);
        }, 1500);
      });
  }, [act]);

  // An import runs on the computer that started it (it has the PDF). One from
  // before imports were tied to a computer is claimed by the computer that
  // has its PDF; other computers just show its progress.
  useEffect(() => {
    stateRef.current = state;
    runRef.current = run;
    if (!device) return;
    for (const j of state?.bookJobs || []) {
      if (j.status !== "running") continue;
      if (j.deviceId === device.id) run(j.id);
      else if (!j.deviceId && !checked.current.has(j.id)) {
        checked.current.add(j.id);
        bookBridge()?.has?.(j.bookId).then(has => {
          if (has) act("book/patch", { id: j.id, patch: { deviceId: device.id, deviceName: device.name } });
        });
      }
    }
  }, [state, run, device, act]);

  const value = useMemo(() => ({
    pause: (id) => act("book/patch", { id, patch: { status: "paused" } }),
    // Resume also retries chapters that failed.
    resume: (id) => {
      const job = stateRef.current.bookJobs.find(j => j.id === id);
      if (!job) return;
      job.chapters.forEach((c, i) => { if (c.status === "failed") act("book/chapter", { id, index: i, patch: { status: "pending", error: "" } }); });
      act("book/patch", { id, patch: { status: "running", error: "" } });
    },
    dismiss: (id) => {
      const job = stateRef.current.bookJobs.find(j => j.id === id);
      if (job) bookBridge()?.remove(job.bookId);
      act("book/dismiss", { id });
    },
    setRead: (id, index, read) => act("book/chapter", { id, index, patch: { read } }),
  }), [act]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useBookImport = () => useContext(Ctx);

/** Summary numbers for a job, for progress displays. */
// eslint-disable-next-line react-refresh/only-export-components
export function jobProgress(job) {
  const chosen = job.chapters.filter(c => c.include);
  const done = chosen.filter(c => c.status === "done").length;
  const failed = chosen.filter(c => c.status === "failed").length;
  const active = chosen.find(c => c.status === "reading" || c.status === "writing");
  return { total: chosen.length, done, failed, active, finished: done + failed === chosen.length };
}
