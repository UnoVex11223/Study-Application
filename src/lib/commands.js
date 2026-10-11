// Everything the command palette (Ctrl+K) can find, as plain data: actions,
// pages, courses, chapters, concepts, books on the shelf and notes. Each entry
// says where it goes ({ to: { view, params } }) or what it does ({ action }),
// and the palette carries it out. Entries with `suggest` show before you type.

import { index } from "./model.js";
import { dueForRecall } from "./recall.js";
import { SHELF_KINDS } from "./shelf.js";

export const PAGES = [
  { id: "today", label: "Today", icon: "today" },
  { id: "courses", label: "Courses", icon: "courses" },
  { id: "notes", label: "Notes", icon: "note" },
  { id: "progress", label: "Progress", icon: "progress" },
  { id: "map", label: "Knowledge map", icon: "map" },
  { id: "shelf", label: "Shelf", icon: "shelf" },
  { id: "settings", label: "Settings", icon: "settings" },
];

/** How the palette names each kind of entry, in the order its groups appear before you type. */
export const KINDS = {
  action: "Actions", page: "Go to", course: "Courses", chapter: "Chapters",
  concept: "Concepts", book: "Shelf", note: "Notes",
};

const firstLine = (text, n) => {
  const line = String(text || "").split("\n").find(l => l.trim()) || "";
  return line.length > n ? `${line.slice(0, n - 1).trim()}…` : line.trim();
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Every entry for this state. `at` makes pages that open something (a form, a panel) open it again. */
export function commandEntries(state, { plan = null, now = Date.now(), syncing = false, at = now } = {}) {
  const ix = index(state);
  const out = [];
  const add = (e) => out.push(e);

  if (plan?.tasks?.length) {
    add({ kind: "action", id: "a:session", title: "Start today's session", sub: plural(plan.tasks.length, "question"), icon: "play", action: "session", suggest: true, boost: 6 });
  }
  const recall = dueForRecall(state.shelf, now).length;
  if (recall) add({ kind: "action", id: "a:recall", title: "Recall books from your shelf", sub: `${recall} due`, icon: "play", to: { view: "shelf", params: { recall: true, at } }, suggest: true });
  const flagged = state.items.filter(i => i.flag).length;
  if (flagged) add({ kind: "action", id: "a:fix", title: "Fix reported questions", sub: `${flagged} waiting`, icon: "flag", to: { view: "today", params: { fix: at } }, suggest: true });
  add({ kind: "action", id: "a:note", title: "Capture a note", icon: "note", keys: "Ctrl Shift N", to: { view: "notes", params: { capture: at } }, suggest: true });
  add({ kind: "action", id: "a:course", title: "Create a course", icon: "plus", to: { view: "courses", params: { create: true, at } }, suggest: true });
  add({ kind: "action", id: "a:book", title: "Import a book", icon: "book", to: { view: "book", params: { at } }, suggest: true });
  const year = new Date(now).getFullYear();
  add({ kind: "action", id: "a:year", title: `${year} on your shelf`, icon: "shelf", to: { view: "shelf", params: { year, at } } });
  add({ kind: "action", id: "a:shelf", title: "Add to shelf", icon: "shelf", to: { view: "shelf", params: { add: at } }, suggest: true });
  const paper = state.settings.theme === "light";
  add({ kind: "action", id: "a:theme", title: paper ? "Switch to the black theme" : "Switch to the paper theme", icon: paper ? "moon" : "sun", action: "theme" });
  add({ kind: "action", id: "a:sounds", title: state.settings.sounds ? "Turn sounds off" : "Turn sounds on", icon: state.settings.sounds ? "mute" : "volume", action: "sounds" });
  if (syncing) add({ kind: "action", id: "a:sync", title: "Sync now", icon: "undo", action: "sync" });

  for (const p of PAGES) add({ kind: "page", id: `p:${p.id}`, title: p.label, icon: p.icon, to: { view: p.id }, suggest: true, boost: 1 });

  for (const c of state.courses) {
    if (c.kind === "notes") continue;
    const n = (ix.sectionsByCourse[c.id] || []).length;
    add({ kind: "course", id: `c:${c.id}`, title: c.name, sub: plural(n, "chapter"), color: c.color, to: { view: "course", params: { courseId: c.id } }, boost: 3 });
  }
  for (const s of state.sections) {
    const c = ix.course[s.courseId];
    if (!c || c.kind === "notes") continue;
    add({ kind: "chapter", id: `s:${s.id}`, title: s.title, sub: c.name, color: c.color, to: { view: "course", params: { courseId: c.id, sectionId: s.id, at } } });
  }
  for (const k of state.concepts) {
    const c = ix.course[k.courseId];
    if (!c) continue;
    const notes = c.kind === "notes";
    const topic = ix.section[k.sectionId]?.title;
    add({
      kind: notes ? "note" : "concept", id: `k:${k.id}`, title: k.name,
      sub: notes ? `Notes${topic ? ` · ${topic}` : ""}` : c.name, color: c.color,
      to: { view: "course", params: { courseId: c.id, conceptId: k.id, at } }, boost: k.suspended ? -3 : 0,
    });
  }
  for (const it of state.shelf) {
    if (it.courseId || it.hidden) continue;
    add({ kind: "book", id: `b:${it.id}`, title: it.title || "Untitled", sub: it.author || SHELF_KINDS[it.kind]?.label || "", icon: "book", to: { view: "shelf", params: { open: it.id, at } } });
  }
  for (const n of state.notes) {
    if (n.status !== "inbox") continue;
    add({ kind: "note", id: `n:${n.id}`, title: firstLine(n.text, 72), sub: n.context ? `Inbox · ${n.context}` : "Inbox", icon: "note", to: { view: "notes" } });
  }
  return out;
}

/**
 * Results in groups for display: [{ kind, label, rows }]. Before you type the
 * groups keep their usual order; after, the group with the best match comes
 * first. Each group shows at most `per` rows.
 */
export function groupResults(results, { typed = false, per = 6 } = {}) {
  const groups = new Map();
  for (const r of results) {
    if (!groups.has(r.kind)) groups.set(r.kind, { kind: r.kind, label: KINDS[r.kind] ?? r.kind, rows: [], best: -Infinity });
    const g = groups.get(r.kind);
    if (g.rows.length < per) g.rows.push(r);
    g.best = Math.max(g.best, r.score ?? 0);
  }
  const order = Object.keys(KINDS);
  return [...groups.values()].sort((a, b) => (typed ? b.best - a.best : 0) || order.indexOf(a.kind) - order.indexOf(b.kind));
}
