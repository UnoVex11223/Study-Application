// What changed between two versions of the library, so only that is saved
// (db.cjs applies it). Pure; unit-tested in tests/delta.test.js.
//
// The reducer never edits a record in place: a changed record is a new object
// and an unchanged one is the same object as before. So comparing by identity
// finds exactly what an action touched, without comparing contents.
//
//   { upsert: { kind: [records] }, remove: { kind: [ids] }, attempts: [new reviews],
//     tombstones: { set: { id: ts }, remove: [ids] }, meta: { key: value }, empty }
//
// Reviews are only ever added here: when the in-memory history drops its
// oldest reviews (it keeps the newest 30,000), they stay in the database.
// Deleting a concept deletes its reviews there (db.cjs).

import { RECORD_COLLECTIONS } from "./model.js";

const OWN_TABLES = new Set(["attempts", "tombstones"]);

export function diffLibrary(prev, next) {
  const delta = { upsert: {}, remove: {}, attempts: [], tombstones: { set: {}, remove: [] }, meta: {}, empty: true };
  const changed = () => { delta.empty = false; };

  for (const kind of RECORD_COLLECTIONS) {
    const before = prev[kind] || [], after = next[kind] || [];
    if (before === after) continue;
    const old = new Map(before.map(r => [r.id, r]));
    const upserts = after.filter(r => old.get(r.id) !== r);
    const ids = new Set(after.map(r => r.id));
    const removed = before.filter(r => !ids.has(r.id)).map(r => r.id);
    if (upserts.length) { delta.upsert[kind] = upserts; changed(); }
    if (removed.length) { delta.remove[kind] = removed; changed(); }
  }

  if (prev.attempts !== next.attempts) {
    const had = new Set(prev.attempts || []);
    delta.attempts = (next.attempts || []).filter(a => !had.has(a));
    if (delta.attempts.length) changed();
  }

  if (prev.tombstones !== next.tombstones) {
    const before = prev.tombstones || {}, after = next.tombstones || {};
    for (const [id, ts] of Object.entries(after)) if (before[id] !== ts) { delta.tombstones.set[id] = ts; changed(); }
    for (const id of Object.keys(before)) if (!(id in after)) { delta.tombstones.remove.push(id); changed(); }
  }

  // Everything else at the top level (settings, per-day extras, version…).
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (RECORD_COLLECTIONS.includes(key) || OWN_TABLES.has(key) || prev[key] === next[key]) continue;
    delta.meta[key] = next[key] ?? null;
    changed();
  }
  return delta;
}
