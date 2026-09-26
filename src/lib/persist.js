// Persistence. In the desktop app, state lives in electron-store (a local JSON
// file) via the preload bridge. In a plain browser (dev/testing) it falls back
// to localStorage.

import { emptyState, normalizeState } from "./model.js";

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
  return stored ? normalizeState(stored) : emptyState();
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
