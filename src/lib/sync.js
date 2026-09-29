// Merging copies of your library from several computers (see the sync folder
// in electron.cjs). Each computer writes its own copy; on start-up and every
// few minutes, the others' copies are merged into this one:
//   • records (courses, sections, concepts, questions, links, notes, imports, shelf):
//     the newest version of each wins, by updatedAt
//   • deletions: a record deleted after its last edit elsewhere stays deleted
//   • review history: combined from all computers
//   • settings: the most recently changed copy wins
// Pure functions; unit-tested in tests/sync.test.js.

import { normalizeState, SCHEMA_VERSION } from "./model.js";

const COLLECTIONS = ["courses", "sections", "concepts", "items", "edges", "notes", "bookJobs", "shelf"];
const MAX_ATTEMPTS = 30000;

const attemptKey = (a) => `${a.ts}|${a.itemId}|${a.mode || ""}|${a.rating ?? ""}`;

/** Newest version of each record across copies, minus deletions. */
function mergeCollection(lists, tombstones) {
  const best = new Map();
  for (const list of lists) {
    for (const r of list || []) {
      const cur = best.get(r.id);
      if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) best.set(r.id, r);
    }
  }
  return [...best.values()].filter(r => !(tombstones[r.id] >= (r.updatedAt || 0)));
}

/** Keep one of each link (same ends and type), the newest. */
function dedupeEdges(edges) {
  const byKey = new Map();
  for (const e of edges) {
    const k = `${e.type}|${e.from}|${e.to}`;
    const cur = byKey.get(k);
    if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) byKey.set(k, e);
  }
  return [...byKey.values()];
}

/** Keep one of each note text: a processed copy beats one still in an inbox. */
function dedupeNotes(notes) {
  const rank = (n) => (n.status === "done" ? 2 : n.status === "skipped" ? 1 : 0);
  const byHash = new Map();
  for (const n of notes) {
    const cur = byHash.get(n.hash);
    if (!cur || rank(n) > rank(cur) || (rank(n) === rank(cur) && (n.updatedAt || 0) > (cur.updatedAt || 0))) byHash.set(n.hash, n);
  }
  return [...byHash.values()];
}

/**
 * Merge `others` into `local`. Copies written by a newer version of the app
 * (a higher schema version) are skipped and reported, so an older install
 * never mangles data it doesn't understand.
 * Returns { state, changed, skipped: [deviceName] }.
 */
export function mergeStates(local, others) {
  const usable = [], skipped = [];
  for (const o of others) {
    if ((o.state?.version ?? 0) > SCHEMA_VERSION) skipped.push(o.deviceName || "another computer");
    else if (o.state) usable.push(normalizeState(o.state));
  }
  if (!usable.length) return { state: local, changed: false, skipped };
  const all = [local, ...usable];

  const tombstones = {};
  for (const s of all) for (const [id, ts] of Object.entries(s.tombstones || {})) tombstones[id] = Math.max(tombstones[id] || 0, ts);

  const merged = { ...local, tombstones };
  for (const k of COLLECTIONS) merged[k] = mergeCollection(all.map(s => s[k]), tombstones);
  merged.edges = dedupeEdges(merged.edges);
  merged.notes = dedupeNotes(merged.notes);

  // Keep only what still hangs together after deletions elsewhere.
  const courseIds = new Set(merged.courses.map(c => c.id));
  merged.sections = merged.sections.filter(s => courseIds.has(s.courseId));
  const sectionIds = new Set(merged.sections.map(s => s.id));
  merged.concepts = merged.concepts.filter(c => courseIds.has(c.courseId) && sectionIds.has(c.sectionId));
  const conceptIds = new Set(merged.concepts.map(c => c.id));
  merged.items = merged.items.filter(i => conceptIds.has(i.conceptId));
  merged.edges = merged.edges.filter(e => conceptIds.has(e.from) && conceptIds.has(e.to));
  merged.bookJobs = merged.bookJobs.filter(j => courseIds.has(j.courseId));

  // Review history from every computer.
  const seen = new Set(), attempts = [];
  for (const s of all) for (const a of s.attempts || []) {
    const key = attemptKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    attempts.push(a);
  }
  attempts.sort((a, b) => a.ts - b.ts);
  merged.attempts = attempts.filter(a => conceptIds.has(a.conceptId)).slice(-MAX_ATTEMPTS);

  // Settings and per-day extras: the most recently changed copy wins.
  const newest = (key) => all.reduce((best, s) => ((s[key] || 0) > (best[key] || 0) ? s : best), local);
  const settingsFrom = newest("settingsUpdatedAt");
  merged.settings = settingsFrom.settings;
  merged.settingsUpdatedAt = settingsFrom.settingsUpdatedAt || 0;
  const days = {};
  for (const s of all) for (const [d, v] of Object.entries(s.days || {})) days[d] = { ...v, extraSec: Math.max(days[d]?.extraSec || 0, v?.extraSec || 0) };
  merged.days = days;
  merged.version = Math.max(...all.map(s => s.version || 0));

  const out = normalizeState(merged);
  return { state: out, changed: fingerprint(out) !== fingerprint(local), skipped };
}

/** Hash of every record's id and last change, for "did anything change?". */
export function fingerprint(s) {
  let h = 0x811c9dc5;
  const add = (str) => { for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); };
  for (const k of COLLECTIONS) for (const r of s[k] || []) add(`${k}:${r.id}:${r.updatedAt || 0};`);
  add(`a${s.attempts?.length || 0}:${s.attempts?.at(-1)?.ts || 0};t${Object.keys(s.tombstones || {}).length};s${s.settingsUpdatedAt || 0}`);
  return (h >>> 0).toString(16);
}
