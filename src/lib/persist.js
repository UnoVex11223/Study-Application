// Loading and saving the library.
//
// In the desktop app the library is a SQLite database the main process owns
// (db.cjs). After a change, only what changed is sent (lib/delta.js), a
// quarter of a second later so a burst of changes goes together. A save that
// fails is kept and tried again (everything since the last good save goes
// with the next try), and anyone listening (onSaveStatus) is told, so the app
// can say so. When the window closes, anything still waiting is sent before
// it goes. In a plain browser (development, testing) the library is one
// localStorage value instead.

import { emptyState, normalizeState } from "./model.js";
import { diffLibrary } from "./delta.js";
import { mergeStates } from "./sync.js";

const KEY = "af3_state";
const DELAY = 250;
const RETRY_MS = [1000, 3000, 10000, 30000];

const database = () => (typeof window !== "undefined" && window.tenax?.db) || null;
const storeBridge = () => (typeof window !== "undefined" && window.tenax?.store) || null;

let saved = null;        // the library as it is on disk
let pending = null;      // the newest library, not saved yet
let replaceAll = false;  // the next save replaces everything (a restore, a reset)
let timer = null;
let failures = 0;
let queue = Promise.resolve();
let loading = null;
const listeners = new Set();
let status = { error: "" };

/** Hear whether saving works: fn({ error }) now and whenever it changes. Returns an unsubscribe. */
export function onSaveStatus(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}
const report = (error) => { status = { error }; for (const fn of listeners) fn(status); };
const check = (res) => { if (!res?.ok) throw new Error(res?.error || "The change couldn't be saved."); return res; };

function readLocal() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeLocal(state) {
  localStorage.setItem(KEY, JSON.stringify(state)); // throws when storage is full: reported like any failed save
}

async function load() {
  const db = database();
  if (!db) {
    const stored = readLocal();
    saved = stored ? normalizeState(stored) : emptyState();
    return { state: saved, recovered: null };
  }
  const res = await db.load();
  if (!res?.ok) throw new Error(res?.error || "Tenax couldn't open its library.");
  let state = res.state ? normalizeState(res.state) : null;
  // A library from before the database (or written since by an older version
  // on this computer) is brought in, then archived. If anything fails, it
  // stays where it is and is tried again next time.
  if (res.legacy) {
    const legacy = normalizeState(res.legacy);
    if (!state) {
      state = legacy;
      check(await db.replace(state));
    } else {
      const merged = mergeStates(state, [{ deviceName: "an earlier version of Tenax", state: legacy }]).state;
      const delta = diffLibrary(state, merged);
      if (!delta.empty) check(await db.apply(delta));
      state = merged;
    }
    check(await db.legacyDone());
  }
  saved = state ?? emptyState();
  return { state: saved, recovered: res.recovered ?? null };
}

/** The library: { state, recovered } (recovered: the file was damaged and a backup restored). Loads once. */
export function loadState() {
  loading ??= load().catch((err) => { loading = null; throw err; });
  return loading;
}

/** Save this version of the library (soon). full: replace everything rather than send what changed. */
export function saveState(state, { full = false } = {}) {
  if (state === saved && !full) return;
  pending = state;
  replaceAll ||= full;
  clearTimeout(timer);
  timer = setTimeout(flush, DELAY);
}

async function write() {
  if (!pending || (pending === saved && !replaceAll)) return;
  const next = pending, full = replaceAll;
  pending = null;
  replaceAll = false;
  const db = database();
  try {
    if (!db) writeLocal(next);
    else if (full) check(await db.replace(next));
    else {
      const delta = diffLibrary(saved, next);
      if (!delta.empty) check(await db.apply(delta));
    }
    saved = next;
    if (failures) { failures = 0; report(""); }
  } catch (err) {
    // Keep it: the next try sends everything since the last good save.
    pending ??= next;
    replaceAll ||= full;
    failures += 1;
    report(err?.message || "The change couldn't be saved.");
    clearTimeout(timer);
    timer = setTimeout(flush, RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]);
  }
}

/** Save now whatever is waiting. Saves happen one after another, never at once. */
export function flush() {
  clearTimeout(timer);
  queue = queue.then(write, write);
  return queue;
}

/** The window is closing: send what's left synchronously, so it can't be lost. */
function flushNow() {
  clearTimeout(timer);
  if (!pending || (pending === saved && !replaceAll)) return;
  const db = database();
  try {
    if (!db) writeLocal(pending);
    else if (!db.saveNow(replaceAll ? { state: pending } : { delta: diffLibrary(saved, pending) })?.ok) return;
    saved = pending;
    pending = null;
    replaceAll = false;
  } catch { /* nothing more can be done as the window closes */ }
}
if (typeof window !== "undefined") window.addEventListener("beforeunload", flushNow);

// ── The API key (kept outside the library, encrypted by the main process) ──
export async function getApiKeySet() {
  const ai = typeof window !== "undefined" && window.tenax?.ai;
  if (ai?.status) { try { return (await ai.status()).hasKey; } catch { return false; } }
  try { return Boolean(localStorage.getItem("af_api_key")); } catch { return false; }
}

export function setApiKey(key) {
  const b = storeBridge();
  if (b) return b.set("af_api_key", key || null).catch(() => {});
  try {
    if (key) localStorage.setItem("af_api_key", JSON.stringify(key));
    else localStorage.removeItem("af_api_key");
  } catch { /* storage unavailable */ }
  return Promise.resolve();
}
