// All state changes, as a pure reducer (unit-tested in tests/).
import { emptyState, normalizeState, index } from "../lib/model.js";
import { rate, newSrs, RATING } from "../lib/fsrs.js";
import { makeLoadAt } from "../lib/planner.js";
import { mergeEdges } from "../lib/graph.js";
import { dayKey } from "../lib/time.js";
import { LEECH_LAPSES, DISPUTE_LIMIT } from "../lib/quality.js";
import { mergeStates } from "../lib/sync.js";

const MAX_ATTEMPTS = 30000;

function removeConcepts(state, ids) {
  const gone = new Set(ids);
  const itemIds = new Set(state.items.filter(i => gone.has(i.conceptId)).map(i => i.id));
  return {
    ...state,
    concepts: state.concepts.filter(c => !gone.has(c.id)),
    items: state.items.filter(i => !itemIds.has(i.id)),
    edges: state.edges.filter(e => !gone.has(e.from) && !gone.has(e.to)),
    attempts: state.attempts.filter(a => !gone.has(a.conceptId)),
  };
}

function apply(state, action) {
  if (action.type === "load") return action.state;
  if (!state) return state;

  switch (action.type) {
    case "course/add":
      return { ...state, courses: [...state.courses, action.course] };
    case "course/update":
      return { ...state, courses: state.courses.map(c => (c.id === action.id ? { ...c, ...action.patch } : c)) };
    case "course/delete": {
      const ids = state.concepts.filter(c => c.courseId === action.id).map(c => c.id);
      const next = removeConcepts(state, ids);
      // Its shelf item stays, as a standalone entry with the progress it had.
      const course = state.courses.find(c => c.id === action.id);
      const sections = state.sections.filter(s => s.courseId === action.id);
      return {
        ...next,
        courses: next.courses.filter(c => c.id !== action.id),
        sections: next.sections.filter(s => s.courseId !== action.id),
        bookJobs: next.bookJobs.filter(j => j.courseId !== action.id),
        shelf: next.shelf.some(it => it.courseId === action.id)
          ? next.shelf.map(it => (it.courseId !== action.id ? it : {
            ...it, courseId: null, title: it.title || course?.name || "Untitled",
            total: Math.max(it.total || 0, sections.length), done: Math.max(it.done || 0, sections.filter(s => !s.locked).length),
          }))
          : next.shelf,
      };
    }

    // The shelf (see lib/shelf.js).
    case "shelf/add":
      return { ...state, shelf: [...state.shelf, action.item] };
    case "shelf/import":
      return { ...state, shelf: [...state.shelf, ...action.items] };
    case "shelf/update":
      return { ...state, shelf: state.shelf.map(it => (it.id === action.id ? { ...it, ...action.patch } : it)) };
    case "shelf/remove":
      return { ...state, shelf: state.shelf.filter(it => it.id !== action.id) };

    case "section/update":
      return { ...state, sections: state.sections.map(s => (s.id === action.id ? { ...s, ...action.patch } : s)) };
    case "section/add":
      return { ...state, sections: [...state.sections, action.section] };
    case "section/lock":
      return { ...state, sections: state.sections.map(s => (s.id === action.id ? { ...s, locked: Boolean(action.locked), ...(action.locked ? {} : { readAt: action.now }) } : s)) };

    // Whole-book imports.
    case "book/start":
      return {
        ...state,
        courses: action.course ? [...state.courses, action.course] : state.courses,
        bookJobs: [...state.bookJobs, action.job],
      };
    case "book/patch":
      return { ...state, bookJobs: state.bookJobs.map(j => (j.id === action.id ? { ...j, ...action.patch } : j)) };
    case "book/chapter":
      return {
        ...state,
        bookJobs: state.bookJobs.map(j => (j.id !== action.id ? j : {
          ...j, chapters: j.chapters.map((c, i) => (i === action.index ? { ...c, ...action.patch } : c)),
        })),
      };
    // Notes.
    case "notes/add":
      return { ...state, notes: [...state.notes, ...action.notes] };
    case "notes/remove":
      return { ...state, notes: state.notes.filter(n => n.id !== action.id) };
    case "notes/requeue": // "Keep anyway" on a skipped note, or retry
      return { ...state, notes: state.notes.map(n => (n.id === action.id ? { ...n, status: "inbox", force: Boolean(action.force), reason: "" } : n)) };
    case "notes/import": {
      const { course, noteUpdates = [], ...payload } = action.payload;
      let next = course ? { ...state, courses: [...state.courses, course] } : state;
      next = apply(next, { type: "import", payload });
      const patches = new Map(noteUpdates.map(u => [u.id, u.patch]));
      return { ...next, notes: next.notes.map(n => (patches.has(n.id) ? { ...n, ...patches.get(n.id) } : n)) };
    }

    case "book/dismiss":
      return { ...state, bookJobs: state.bookJobs.filter(j => j.id !== action.id) };

    case "section/delete": {
      const ids = state.concepts.filter(c => c.sectionId === action.id).map(c => c.id);
      const next = removeConcepts(state, ids);
      return { ...next, sections: next.sections.filter(s => s.id !== action.id) };
    }

    case "import": {
      const { sections = [], concepts = [], items = [], edges = [] } = action.payload;
      const merged = mergeEdges(state.edges, edges);
      const next = {
        ...state,
        sections: [...state.sections, ...sections],
        concepts: [...state.concepts, ...concepts],
        items: [...state.items, ...items],
        edges: [...state.edges, ...merged.accepted],
      };
      // A book chapter's import and its "done" mark are saved together, so a
      // restart can never import the same chapter twice.
      return action.bookChapter ? apply(next, { type: "book/chapter", ...action.bookChapter }) : next;
    }

    case "edges/add": {
      const merged = mergeEdges(state.edges, action.edges);
      return merged.accepted.length ? { ...state, edges: [...state.edges, ...merged.accepted] } : state;
    }
    case "edge/delete":
      return { ...state, edges: state.edges.filter(e => e.id !== action.id) };
    case "edge/confirm":
      return { ...state, edges: state.edges.map(e => (e.id === action.id ? { ...e, confidence: 1, origin: "user" } : e)) };

    case "concept/update":
      return { ...state, concepts: state.concepts.map(c => (c.id === action.id ? { ...c, ...action.patch } : c)) };
    case "concept/delete":
      return removeConcepts(state, [action.id]);

    case "item/add":
      return { ...state, items: [...state.items, action.item] };
    case "items/add": {
      // Only for concepts that still exist (a top-up may finish after a delete).
      const ids = new Set(state.concepts.map(c => c.id));
      const items = action.items.filter(i => ids.has(i.conceptId));
      return items.length ? { ...state, items: [...state.items, ...items] } : state;
    }
    case "item/update":
      return { ...state, items: state.items.map(i => (i.id === action.id ? { ...i, ...action.patch } : i)) };
    case "item/delete":
      return { ...state, items: state.items.filter(i => i.id !== action.id) };

    // Reported or automatically flagged questions leave sessions until fixed.
    case "item/flag":
      return { ...state, items: state.items.map(i => (i.id === action.id ? { ...i, flag: { reason: action.reason, note: action.note || "", at: action.now } } : i)) };
    case "item/unflag":
      return { ...state, items: state.items.map(i => (i.id === action.id ? { ...i, flag: null, flagCleared: action.now } : i)) };
    case "item/replace":
      // A rewritten question is a new question: its history starts over, no flag.
      // The concept's memory schedule is unchanged.
      return {
        ...state,
        items: state.items.map(i => (i.id === action.id
          ? { ...i, ...action.fields, flag: null, flagCleared: action.now, resetAt: action.now, quality: { ...(i.quality || {}), rewritten: true } }
          : i)),
      };

    // Teach-back gaps: concepts come back in your next session.
    case "concepts/bringForward": {
      const ids = new Set(action.ids);
      return {
        ...state,
        concepts: state.concepts.map(c => (ids.has(c.id) && c.srs && c.srs.state !== "new" ? { ...c, srs: { ...c.srs, due: Math.min(c.srs.due ?? action.now, action.now) } } : c)),
      };
    }

    case "attempt": {
      const { itemId, verdict, rating, aided = false, ms = 0, mode = "session", misconceptions = [], overridden = false, now } = action;
      const ix = index(state);
      const item = ix.item[itemId];
      if (!item) return state;
      const concept = ix.concept[item.conceptId];
      if (!concept) return state;
      const srs = rating
        ? rate(concept.srs ?? newSrs(), rating, now, { retention: state.settings.retention, loadAt: makeLoadAt(state) })
        : concept.srs;
      const attempt = {
        ts: now, day: dayKey(now, state.settings.rolloverHour),
        itemId, conceptId: item.conceptId, courseId: concept?.courseId ?? null, ability: item.ability,
        verdict, rating: rating ?? null, aided, mode, ms: Math.round(ms),
        ...(misconceptions.length ? { misconceptions } : {}),
        ...(overridden ? { overridden: true } : {}),
      };
      const attempts = state.attempts.length >= MAX_ATTEMPTS
        ? [...state.attempts.slice(-MAX_ATTEMPTS + 1), attempt]
        : [...state.attempts, attempt];
      // Questions you keep missing, or whose grading you keep overruling, are
      // usually bad questions: pull them until you fix or restore them.
      let flag = item.flag || null;
      if (!flag) {
        const since = Math.max(item.flagCleared || 0, item.resetAt || 0);
        const mine = attempts.filter(a => a.itemId === itemId && a.ts > since);
        const missDays = new Set(mine.filter(a => a.rating === RATING.AGAIN).map(a => a.day)).size;
        const disputes = mine.filter(a => a.overridden).length;
        if (missDays >= LEECH_LAPSES) flag = { reason: "leech", at: now };
        else if (disputes >= DISPUTE_LIMIT) flag = { reason: "disputed", at: now };
      }
      return {
        ...state,
        concepts: srs === concept.srs ? state.concepts : state.concepts.map(c => (c.id === concept.id ? { ...c, srs } : c)),
        items: flag === item.flag ? state.items : state.items.map(i => (i.id === itemId ? { ...i, flag } : i)),
        attempts,
      };
    }

    case "day/extra": {
      const day = dayKey(action.now, state.settings.rolloverHour);
      const cur = state.days?.[day] || {};
      return { ...state, days: { ...state.days, [day]: { ...cur, extraSec: (cur.extraSec || 0) + action.sec } } };
    }

    case "settings":
      return { ...state, settings: { ...state.settings, ...action.patch } };

    // Copies from other computers (sync folder), merged into the current state
    // at the moment the action is applied, so nothing done meanwhile is lost.
    case "sync/merge": {
      const r = mergeStates(state, action.copies || []);
      return r.changed ? r.state : state;
    }

    case "replace":
      return normalizeState(action.state);
    case "reset":
      return { ...emptyState(), settings: state.settings };
    default:
      return state;
  }
}

// ── Change tracking (for syncing between computers) ─────────────────────────
// Every record an action changes gets updatedAt = the action's time, and every
// record it removes leaves a deletion marker (tombstone). Merging copies from
// several computers uses these to keep the newest version of each record and
// to carry deletions across. Loads, restores and merges aren't user edits and
// aren't stamped.
const TRACKED = ["courses", "sections", "concepts", "items", "edges", "notes", "bookJobs", "shelf"];
// A restore ("replace") *is* tracked: every restored record counts as edited
// now and everything else as deleted, so the restore wins on your other
// computers too instead of being overridden by their newer copies.
const UNTRACKED_ACTIONS = new Set(["load", "sync/merge"]);
const TOMBSTONE_DAYS = 180;

export function track(prev, next, now, { all = false } = {}) {
  let out = next, tombstones = null;
  if (all) {
    // A restore keeps what this computer had already deleted (so it doesn't
    // come back from another computer), except records the backup brings back.
    tombstones = { ...(prev.tombstones || {}), ...(next.tombstones || {}) };
    for (const k of TRACKED) for (const r of next[k] || []) delete tombstones[r.id];
  }
  for (const k of TRACKED) {
    const a = prev[k], b = next[k];
    if ((a === b && !all) || !Array.isArray(a) || !Array.isArray(b)) continue;
    const before = new Map(a.map(r => [r.id, r]));
    let changed = false;
    const list = b.map(r => {
      if (!all && before.get(r.id) === r) return r;
      changed = true;
      return { ...r, updatedAt: now };
    });
    const ids = new Set(b.map(r => r.id));
    for (const r of a) {
      if (ids.has(r.id)) continue;
      tombstones ||= { ...(next.tombstones || {}) };
      tombstones[r.id] = now;
    }
    if (changed) out = { ...out, [k]: list };
  }
  if (tombstones) {
    const cutoff = now - TOMBSTONE_DAYS * 864e5;
    for (const [id, ts] of Object.entries(tombstones)) if (ts < cutoff) delete tombstones[id];
    out = { ...out, tombstones };
  }
  if (all || prev.settings !== next.settings) out = { ...out, settingsUpdatedAt: now };
  if (prev.days !== next.days) out = { ...out, daysUpdatedAt: now };
  return out;
}

export function reducer(state, action) {
  const next = apply(state, action);
  if (!state || !next || next === state || action.now == null || UNTRACKED_ACTIONS.has(action.type)) return next;
  return track(state, next, action.now, { all: action.type === "replace" });
}
