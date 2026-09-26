// Persistence. In the desktop app, state lives in electron-store (a local JSON
// file) via the preload bridge. In a plain browser (dev/testing) it falls back
// to localStorage.
//
// The previous app's keys (af_topics, af_log, …) are read once for migration
// and left untouched, so the old data stays on disk as a backup.

import { emptyState, normalizeState } from "./model.js";
import { migrateLegacy } from "./migrate.js";

const KEY = "af3_state";

const bridge = () => (typeof window !== "undefined" && window.aeroflash?.store) || null;

async function get(key) {
  const b = bridge();
  if (b) { try { return await b.get(key); } catch { return null; } }
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function set(key, val) {
  const b = bridge();
  if (b) return b.set(key, val).catch(() => {});
  try {
    if (val == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(val));
  } catch { /* storage full or unavailable */ }
  return Promise.resolve();
}

export async function loadState() {
  const stored = await get(KEY);
  if (stored) return { state: normalizeState(stored), migrated: false };

  const [topics, log] = await Promise.all([get("af_topics"), get("af_log")]);
  if (Array.isArray(topics) && topics.length) {
    const state = migrateLegacy({ topics, log });
    await set(KEY, state);
    return { state, migrated: true };
  }
  return { state: emptyState(), migrated: false };
}

let timer = null;
let pending = null;

/** Debounced save — the reducer can fire many updates in a row. */
export function saveState(state) {
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}

export function flush() {
  clearTimeout(timer);
  if (pending) { set(KEY, pending); pending = null; }
}

if (typeof window !== "undefined") window.addEventListener("beforeunload", flush);

export const getApiKeySet = async () => {
  const ai = typeof window !== "undefined" && window.aeroflash?.ai;
  if (ai?.status) { try { return (await ai.status()).hasKey; } catch { return false; } }
  return Boolean(await get("af_api_key"));
};
export const setApiKey = (key) => set("af_api_key", key || null);
